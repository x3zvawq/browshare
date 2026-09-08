import { createApp } from 'vue'

import App from './App.vue'
import './assets/main.css'
import { i18n } from './i18n.js'
import { router } from './router/index.js'
import { pinia } from './stores/index.js'

const app = createApp(App)

app.use(pinia)
app.use(i18n)
app.use(router)
app.mount('#app')
