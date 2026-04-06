import './style.css'
import { renderLogin } from './login'
import { renderGetStarted } from './getstarted'
import { renderConfirmation } from './confirmation'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="login-root"></div>
`

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

if (pathname === '/getstarted') {
  renderGetStarted()
} else if (pathname === '/confirmation') {
  renderConfirmation()
} else {
  renderLogin()
}