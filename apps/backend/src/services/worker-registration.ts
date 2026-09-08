import { createHash } from 'node:crypto'

import { BrowShareError, createPublicId } from '@browshare/common'
import type { RegisterWorkerRequest, RegisterWorkerResponse } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  workerCredentials,
  workerEnrollments,
  workers,
} from '@browshare/database/schema'
import { and, eq, gt, lte, sql } from 'drizzle-orm'

import { findPostgresDiagnostic } from './database-errors.js'
import type { WorkerCertificateAuthority } from './worker-certificate-authority.js'

const TOKEN_PATTERN = /^bwe_[A-Za-z0-9_-]{43}$/u

export interface WorkerRegistrationPort {
  register(
    enrollmentToken: string,
    input: RegisterWorkerRequest,
    context: { readonly requestId: string },
  ): Promise<RegisterWorkerResponse>
}

export class WorkerRegistrationService implements WorkerRegistrationPort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly certificateAuthority: WorkerCertificateAuthority,
    private readonly controlUrl: string,
  ) {}

  async register(
    enrollmentToken: string,
    input: RegisterWorkerRequest,
    context: { readonly requestId: string },
  ): Promise<RegisterWorkerResponse> {
    if (!TOKEN_PATTERN.test(enrollmentToken)) throw invalidEnrollment()
    const name = input.name.trim()
    if (name.length === 0 || name.length > 128) {
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Worker name must contain between 1 and 128 characters.',
        statusCode: 400,
      })
    }
    const tokenDigest = digestToken(enrollmentToken)
    await this.connection.db
      .update(workerEnrollments)
      .set({ status: 'EXPIRED' })
      .where(
        and(
          eq(workerEnrollments.tokenDigest, tokenDigest),
          eq(workerEnrollments.status, 'ACTIVE'),
          lte(workerEnrollments.expiresAt, sql`now()`),
        ),
      )
    const [available] = await this.connection.db
      .select({ id: workerEnrollments.id })
      .from(workerEnrollments)
      .where(
        and(
          eq(workerEnrollments.tokenDigest, tokenDigest),
          eq(workerEnrollments.status, 'ACTIVE'),
          gt(workerEnrollments.expiresAt, sql`now()`),
        ),
      )
      .limit(1)
    if (available === undefined) throw invalidEnrollment()

    const workerId = createPublicId()
    let certificate
    try {
      certificate = await this.certificateAuthority.issue(workerId, input.publicKeyPem)
    } catch (cause) {
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Worker public key cannot be used for enrollment.',
        statusCode: 400,
        cause,
      })
    }
    const credentialId = createPublicId()

    try {
      const consumed = await this.connection.db.transaction(async (transaction) => {
        const [claimed] = await transaction
          .update(workerEnrollments)
          .set({ status: 'CONSUMED', consumedAt: sql`now()` })
          .where(
            and(
              eq(workerEnrollments.tokenDigest, tokenDigest),
              eq(workerEnrollments.status, 'ACTIVE'),
              gt(workerEnrollments.expiresAt, sql`now()`),
            ),
          )
          .returning({ id: workerEnrollments.id })
        if (claimed === undefined) return false

        await transaction.insert(workers).values({
          id: workerId,
          name,
          reportedHostname: input.metadata.hostname,
          platform: input.metadata.platform,
          architecture: input.metadata.architecture,
          status: 'PENDING',
          capabilities: {},
          versions: { worker: input.metadata.workerVersion },
          metricsSnapshot: {},
        })
        await transaction.insert(workerCredentials).values({
          id: credentialId,
          workerId,
          certificateSerial: certificate.serialNumber,
          certificatePem: certificate.certificatePem,
          publicKeyPem: certificate.publicKeyPem,
          fingerprintSha256: certificate.fingerprintSha256,
          notBefore: certificate.notBefore,
          expiresAt: certificate.expiresAt,
        })
        await transaction
          .update(workerEnrollments)
          .set({ consumedByWorkerId: workerId })
          .where(eq(workerEnrollments.id, claimed.id))
        await transaction.insert(auditEvents).values({
          id: createPublicId(),
          action: 'worker.enrollment.consume',
          targetType: 'worker',
          targetId: workerId,
          result: 'SUCCEEDED',
          requestId: context.requestId,
          changes: {
            enrollmentId: claimed.id,
            credentialId,
            name,
            reportedHostname: input.metadata.hostname,
            platform: input.metadata.platform,
            architecture: input.metadata.architecture,
            workerVersion: input.metadata.workerVersion,
          },
          metadata: {},
        })
        return true
      })
      if (!consumed) throw invalidEnrollment()
    } catch (cause) {
      if (findPostgresDiagnostic(cause)?.constraint_name === 'workers_name_active_unique') {
        throw new BrowShareError({
          code: 'WORKER_NAME_CONFLICT',
          message: 'An active Worker already uses this name.',
          statusCode: 409,
          cause,
        })
      }
      throw cause
    }

    return {
      workerId,
      credentialId,
      certificatePem: certificate.certificatePem,
      caCertificatePem: this.certificateAuthority.certificatePem,
      certificateSerial: certificate.serialNumber,
      certificateFingerprintSha256: certificate.fingerprintSha256,
      certificateNotBefore: certificate.notBefore,
      certificateExpiresAt: certificate.expiresAt,
      controlUrl: this.controlUrl,
    }
  }
}

export function readWorkerEnrollmentBearer(value: string | undefined): string {
  if (value === undefined) throw invalidEnrollment()
  const separator = value.indexOf(' ')
  if (separator < 1 || value.slice(0, separator).toLowerCase() !== 'bearer') {
    throw invalidEnrollment()
  }
  const token = value.slice(separator + 1)
  if (!TOKEN_PATTERN.test(token)) throw invalidEnrollment()
  return token
}

function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function invalidEnrollment(): BrowShareError {
  return new BrowShareError({
    code: 'WORKER_ENROLLMENT_INVALID',
    message: 'The Worker Enrollment Token is invalid or unavailable.',
    statusCode: 401,
  })
}
