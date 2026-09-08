import 'reflect-metadata'

import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  webcrypto,
  X509Certificate as NodeX509Certificate,
  type KeyObject,
} from 'node:crypto'

import {
  AuthorityKeyIdentifierExtension,
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509Certificate,
  X509CertificateGenerator,
} from '@peculiar/x509'

const WORKER_KEY_ALGORITHM = {
  name: 'ECDSA',
  namedCurve: 'P-256',
  hash: 'SHA-256',
} as const
const CERTIFICATE_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1000
const CA_EXPIRY_MARGIN_MILLISECONDS = 60 * 1000

export interface IssuedWorkerCertificate {
  readonly certificatePem: string
  readonly publicKeyPem: string
  readonly serialNumber: string
  readonly fingerprintSha256: string
  readonly notBefore: string
  readonly expiresAt: string
}

export class WorkerCertificateAuthority {
  readonly #certificatePem: string
  readonly #certificate: NodeX509Certificate
  readonly #certificateForSigning: X509Certificate
  readonly #privateKey: CryptoKey
  readonly #publicKey: CryptoKey
  readonly #validityMilliseconds: number

  private constructor(options: {
    certificatePem: string
    certificate: NodeX509Certificate
    certificateForSigning: X509Certificate
    privateKey: CryptoKey
    publicKey: CryptoKey
    validityDays: number
  }) {
    this.#certificatePem = options.certificatePem
    this.#certificate = options.certificate
    this.#certificateForSigning = options.certificateForSigning
    this.#privateKey = options.privateKey
    this.#publicKey = options.publicKey
    this.#validityMilliseconds = options.validityDays * 24 * 60 * 60 * 1000
  }

  static async create(options: {
    certificatePem: string
    privateKeyPem: string
    validityDays: number
  }): Promise<WorkerCertificateAuthority> {
    let certificate: NodeX509Certificate
    let privateKey: KeyObject
    try {
      certificate = new NodeX509Certificate(options.certificatePem)
      privateKey = createPrivateKey(options.privateKeyPem)
    } catch (cause) {
      throw new TypeError('Worker CA certificate or private key is not valid PEM', { cause })
    }
    assertP256Key(certificate.publicKey, 'Worker CA certificate')
    assertP256Key(privateKey, 'Worker CA private key')
    if (!certificate.ca) throw new TypeError('Worker CA certificate is not a CA certificate')
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new TypeError('Worker CA certificate does not match its private key')
    }
    const now = Date.now()
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
      throw new TypeError('Worker CA certificate is not currently valid')
    }

    const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' })
    const signingKey = (await webcrypto.subtle.importKey(
      'pkcs8',
      privateKeyDer,
      WORKER_KEY_ALGORITHM,
      false,
      ['sign'],
    )) as unknown as CryptoKey
    const caPublicKey = (await webcrypto.subtle.importKey(
      'spki',
      certificate.publicKey.export({ format: 'der', type: 'spki' }),
      WORKER_KEY_ALGORITHM,
      true,
      ['verify'],
    )) as unknown as CryptoKey
    return new WorkerCertificateAuthority({
      certificatePem: ensureTrailingNewline(options.certificatePem),
      certificate,
      certificateForSigning: new X509Certificate(options.certificatePem),
      privateKey: signingKey,
      publicKey: caPublicKey,
      validityDays: options.validityDays,
    })
  }

  get certificatePem(): string {
    return this.#certificatePem
  }

  async issue(workerId: string, suppliedPublicKeyPem: string): Promise<IssuedWorkerCertificate> {
    let publicKey: KeyObject
    try {
      publicKey = createPublicKey(suppliedPublicKeyPem)
    } catch (cause) {
      throw new TypeError('Worker public key is not valid PEM', { cause })
    }
    assertP256Key(publicKey, 'Worker public key')
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' })
    const importedPublicKey = (await webcrypto.subtle.importKey(
      'spki',
      publicKeyDer,
      WORKER_KEY_ALGORITHM,
      true,
      ['verify'],
    )) as unknown as CryptoKey

    const now = Date.now()
    const caNotBefore = Date.parse(this.#certificate.validFrom)
    const caNotAfter = Date.parse(this.#certificate.validTo)
    const notBefore = new Date(Math.max(caNotBefore, now - CERTIFICATE_CLOCK_SKEW_MILLISECONDS))
    const notAfterMilliseconds = Math.min(
      now + this.#validityMilliseconds,
      caNotAfter - CA_EXPIRY_MARGIN_MILLISECONDS,
    )
    if (notAfterMilliseconds <= now) {
      throw new TypeError('Worker CA expires too soon to issue a Worker certificate')
    }
    const notAfter = new Date(notAfterMilliseconds)
    const serialNumber = createCertificateSerial()
    const certificate = await X509CertificateGenerator.create({
      serialNumber,
      subject: `CN=${workerId}`,
      issuer: this.#certificateForSigning.subject,
      notBefore,
      notAfter,
      signingAlgorithm: WORKER_KEY_ALGORITHM,
      publicKey: importedPublicKey,
      signingKey: this.#privateKey,
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.clientAuth], true),
        new SubjectAlternativeNameExtension([
          { type: 'url', value: `urn:browshare:worker:${workerId}` },
        ]),
        await SubjectKeyIdentifierExtension.create(importedPublicKey),
        await AuthorityKeyIdentifierExtension.create(this.#publicKey),
      ],
    })
    const certificatePem = ensureTrailingNewline(certificate.toString('pem'))
    const parsed = new NodeX509Certificate(certificatePem)
    if (!parsed.verify(this.#certificate.publicKey)) {
      throw new Error('Issued Worker certificate failed CA signature verification')
    }

    return {
      certificatePem,
      publicKeyPem: ensureTrailingNewline(
        publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      ),
      serialNumber: parsed.serialNumber,
      fingerprintSha256: parsed.fingerprint256,
      notBefore: new Date(parsed.validFrom).toISOString(),
      expiresAt: new Date(parsed.validTo).toISOString(),
    }
  }
}

function assertP256Key(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new TypeError(`${label} must use ECDSA P-256`)
  }
}

function createCertificateSerial(): string {
  const bytes = randomBytes(20)
  bytes[0] = (bytes[0] ?? 0) & 0x7f
  if (bytes.every((value) => value === 0)) bytes[bytes.length - 1] = 1
  return bytes.toString('hex')
}

function ensureTrailingNewline(value: string): string {
  return `${value.trimEnd()}\n`
}
