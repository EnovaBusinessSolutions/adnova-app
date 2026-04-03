import './style.css'
import { renderLogin } from './login'
import { renderGetStarted } from './getstarted'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="login-root"></div>
`

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

if (pathname === '/getstarted') {
  renderGetStarted()
} else {
  renderLogin()
}