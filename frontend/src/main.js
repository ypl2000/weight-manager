import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'
import { initSync } from './sync'
import { refreshAll } from './store'

const routes = [
  { path: '/', component: () => import('./views/Today.vue') },
  { path: '/data', component: () => import('./views/Data.vue') },
  { path: '/stage', component: () => import('./views/Stage.vue') },
  { path: '/training', component: () => import('./views/Training.vue') },
  { path: '/coach', component: () => import('./views/Coach.vue') },
  { path: '/settings', component: () => import('./views/Settings.vue') },
]

createApp(App)
  .use(createRouter({ history: createWebHashHistory(), routes }))
  .mount('#app')

initSync()
refreshAll()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
