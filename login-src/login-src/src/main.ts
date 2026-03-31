import './style.css'
import { renderLogin } from './login'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="login-root"></div>
`

renderLogin()