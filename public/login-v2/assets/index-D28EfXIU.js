(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=[`/api/login`,`/login`,`/api/auth/login`];function t(e){return String(e||``).trim().toLowerCase()}function n(e){return String(e||``)}function r(e,r,i){let a={email:t(e),password:n(r)};return i&&String(i).trim()&&(a.turnstileToken=String(i).trim()),a}async function i(e){if((e.headers.get(`content-type`)||``).toLowerCase().includes(`application/json`))try{return await e.json()}catch{return null}try{let t=await e.text();return t?{success:e.ok,ok:e.ok,message:t}:null}catch{return null}}function a(e){return e?e.success===!0||e.ok===!0||e.authenticated===!0:!1}function o(e,t){return!!(t?.requiresCaptcha===!0||t?.code===`TURNSTILE_REQUIRED_OR_FAILED`||t?.code===`TURNSTILE_FAILED`||Array.isArray(t?.errorCodes)&&t.errorCodes.length>0||e.status===429&&t?.requiresCaptcha)}function s(e,t){return t?.message?t.message:t?.error?t.error:e.status===401?`Correo o contraseña incorrectos.`:e.status===403?`Tu correo aún no está verificado. Revisa tu bandeja de entrada.`:e.status===400?`No se pudo iniciar sesión.`:e.status>=500?`Error del servidor.`:`No se pudo iniciar sesión (HTTP ${e.status}).`}async function c(e,t,n,a){let o=r(t,n,a),s=await fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`},credentials:`include`,cache:`no-store`,body:JSON.stringify(o)});return{res:s,data:await i(s),endpoint:e}}async function l(t,n,r){let i=null;for(let a of e){let e=await c(a,t,n,r);if(i=e,!(e.res.status===404||e.res.status===405))return e}if(i)return i;throw Error(`No se encontró un endpoint de login disponible.`)}async function u(){let e=await fetch(`/api/session`,{credentials:`include`,cache:`no-store`});if(!e.ok)return null;try{return await e.json()}catch{return null}}async function d(){let e=0;for(;e<12;){let t=await u();if(t&&(t.authenticated||t.ok))return window.location.href=`/dashboard/`,!0;await new Promise(e=>setTimeout(e,250)),e++}return!1}var f=null;function p(){return(document.querySelector(`meta[name="turnstile-site-key"]`)?.getAttribute(`content`)||``).trim()||(document.body?.dataset?.turnstileSitekey||``).trim()||(window.TURNSTILE_SITE_KEY||``).trim()||``}function m(){return(document.querySelector(`input[name="cf-turnstile-response"]`)?.value||``).trim()}function h(){let e=document.getElementById(`turnstile-wrap`);return e?e.style.display!==`none`:!1}function g(){let e=document.getElementById(`turnstile-wrap`);if(e)return e;let t=document.getElementById(`login-form`)||document.querySelector(`form`);e=document.createElement(`div`),e.id=`turnstile-wrap`,e.style.display=`none`,e.style.marginTop=`12px`,e.style.marginBottom=`8px`,e.style.justifyContent=`center`,e.style.alignItems=`center`,e.style.width=`100%`;let n=t?.querySelector(`button[type="submit"]`);return t&&n?.parentElement?n.parentElement.insertBefore(e,n):t?t.appendChild(e):document.body.appendChild(e),e}function _(){let e=document.getElementById(`turnstile-wrap`);e&&(e.style.display=`none`)}function v(){try{f==null?window.turnstile?.reset?.():window.turnstile?.reset?.(f)}catch{}}async function y(){return new Promise((e,t)=>{try{if(window.turnstile&&typeof window.turnstile.render==`function`){e();return}if(document.querySelector(`script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]`)){let n=0,r=window.setInterval(()=>{if(n+=1,window.turnstile&&typeof window.turnstile.render==`function`){window.clearInterval(r),e();return}n>50&&(window.clearInterval(r),t(Error(`Turnstile script no expuso window.turnstile a tiempo.`)))},100);return}let n=document.createElement(`script`);n.src=`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`,n.async=!0,n.defer=!0,n.onload=()=>{let n=0,r=window.setInterval(()=>{if(n+=1,window.turnstile&&typeof window.turnstile.render==`function`){window.clearInterval(r),e();return}n>50&&(window.clearInterval(r),t(Error(`Turnstile script cargó pero no expuso window.turnstile.`)))},100)},n.onerror=()=>t(Error(`No se pudo cargar Turnstile.`)),document.head.appendChild(n)}catch(e){t(e instanceof Error?e:Error(`Error cargando Turnstile.`))}})}async function b(){let e=p();if(!e)throw Error(`Falta configurar el Site Key de Turnstile.`);let t=g();t.style.display=`flex`,t.innerHTML=``;let n=document.createElement(`div`);n.id=`cf-turnstile-slot`,t.appendChild(n),await y(),f=window.turnstile?.render(n,{sitekey:e,size:`normal`,theme:`auto`,appearance:`always`,callback:()=>{},"expired-callback":()=>{try{f!=null&&window.turnstile?.reset?.(f)}catch{}},"error-callback":()=>{try{f!=null&&window.turnstile?.reset?.(f)}catch{}}})??null}var x=`/login-v2/assets/adray-icon-DLI0iEkk.png`;function S(){let e=document.querySelector(`#login-root`);e.innerHTML=`
    <div class="background">
      <div class="background-base"></div>
      <div class="background-grid"></div>
      <div class="background-noise"></div>

      <div class="background-aurora aurora-1"></div>
      <div class="background-aurora aurora-2"></div>
      <div class="background-aurora aurora-3"></div>

      <div class="background-glow glow-top"></div>
      <div class="background-glow glow-left"></div>
      <div class="background-glow glow-right"></div>
      <div class="background-glow glow-bottom"></div>

      <div class="background-orbit orbit-1"></div>
      <div class="background-orbit orbit-2"></div>
      <div class="background-orbit orbit-3"></div>

      <div class="vertical-line"></div>
      <div class="horizontal-line"></div>
    </div>

    <div class="login-container">
      <div class="login-card">
        <div class="login-card-glow" aria-hidden="true"></div>
        <div class="login-card-noise" aria-hidden="true"></div>
        <div class="login-card-aurora" aria-hidden="true"></div>

        <div class="login-topbar login-topbar--minimal">
  <div class="login-brand-icon-wrap" aria-hidden="true">
    <img
      src="${x}"
      alt="Adray"
      class="login-brand-icon"
      decoding="async"
    />
  </div>
</div>

        <h1 class="login-heading">Login to your account</h1>

        <form id="login-form" novalidate>
          <div class="input-group">
            <label class="input-label" for="email">Email</label>
            <input
              id="email"
              class="input"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
            />
          </div>

          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label" for="password">Password</label>
            </div>

            <div class="password-wrap">
              <input
                id="password"
                class="input input-password"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
              />

              <button
                id="toggle-password"
                class="toggle-password"
                type="button"
                aria-label="Show or hide password"
                aria-pressed="false"
              >
                <span class="eye-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <div id="turnstile-wrap"></div>

          <p id="login-message" class="login-message" aria-live="polite"></p>

          <button id="submit-btn" class="btn btn-primary" type="submit">Sign in</button>
        </form>

        <div class="register-wrapper">
          <button id="register-btn" class="btn btn-secondary" type="button">
            Create account
          </button>
        </div>

        <div class="divider">
          <span class="divider-text">OR</span>
        </div>

        <div class="social-buttons">
          <button id="google-btn" class="gsi-material-button" style="width:197px;" type="button">
            <div class="gsi-material-button-state"></div>
            <div class="gsi-material-button-content-wrapper">
              <div class="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span class="gsi-material-button-contents">Continue with Google</span>
              <span style="display:none;">Continue with Google</span>
            </div>
          </button>
        </div>

        <p class="forgot-password">
          Forgot password?
          <a href="/recuperar.html" class="recovery-link">Recover it here</a>
        </p>
      </div>
    </div>
  `,O(),E(),D(),k(),A()}function C(e,t=!1){let n=document.querySelector(`#login-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function w(){let e=document.querySelector(`#login-message`);e&&(e.textContent=``,e.style.display=`none`)}function T(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#register-btn`);t&&(t.disabled=e,t.textContent=e?`Signing in...`:`Sign in`),n&&(n.disabled=e),r&&(r.disabled=e)}function E(){let e=document.querySelector(`#register-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/getstarted`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/auth/google/login`})}function D(){let e=document.querySelector(`#password`),t=document.querySelector(`#toggle-password`);!e||!t||t.addEventListener(`click`,()=>{let n=e.type===`password`;e.type=n?`text`:`password`,t.setAttribute(`aria-pressed`,String(n)),t.classList.toggle(`is-visible`,n),e.focus({preventScroll:!0});try{let t=e.value.length;e.setSelectionRange(t,t)}catch{}})}async function O(){let e=document.querySelector(`#login-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;w();let n=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,r=document.querySelector(`#password`)?.value??``;if(!n||!r){C(`Enter your email and password.`);return}let i=h(),c=i?m():``;if(i&&!c){C(`Complete the security verification to continue.`);return}t=!0,T(!0);try{let{res:e,data:t}=await l(n,r,c||void 0);if(e.ok&&a(t)||e.ok&&t?.redirect){_(),await d()||C(`You signed in, but the session could not be confirmed.`);return}if(o(e,t)){try{await b(),v(),C(`Verification required. Complete the captcha to continue.`)}catch(e){console.error(`[login] captcha error:`,e),C(`Security verification could not be loaded. Refresh the page and try again.`)}return}C(s(e,t))}catch(e){console.error(e),C(`Could not connect to the server.`)}finally{t=!1,T(!1)}})}async function k(){try{let e=await u();e&&(e.authenticated||e.ok)&&window.location.replace(`/dashboard/`)}catch{}}function A(){let e=new URLSearchParams(window.location.search);if(e.get(`verified`)!==`1`)return;C(`Email verified. You can sign in now.`,!0),e.delete(`verified`);let t=window.location.pathname+(e.toString()?`?${e.toString()}`:``)+window.location.hash;window.history.replaceState({},document.title,t)}function j(){let e=document.querySelector(`#login-root`);e&&(e.innerHTML=`
    <div class="background">
      <div class="background-base"></div>
      <div class="background-grid"></div>
      <div class="background-noise"></div>

      <div class="background-aurora aurora-1"></div>
      <div class="background-aurora aurora-2"></div>
      <div class="background-aurora aurora-3"></div>

      <div class="background-glow glow-top"></div>
      <div class="background-glow glow-left"></div>
      <div class="background-glow glow-right"></div>
      <div class="background-glow glow-bottom"></div>

      <div class="background-orbit orbit-1"></div>
      <div class="background-orbit orbit-2"></div>
      <div class="background-orbit orbit-3"></div>

      <div class="vertical-line"></div>
      <div class="horizontal-line"></div>
    </div>

    <div class="login-container">
      <div class="login-card">
        <div class="login-card-glow" aria-hidden="true"></div>
        <div class="login-card-noise" aria-hidden="true"></div>
        <div class="login-card-aurora" aria-hidden="true"></div>

        <div class="login-topbar login-topbar--minimal">
          <div class="login-brand-icon-wrap" aria-hidden="true">
            <img
              src="${x}"
              alt="Adray"
              class="login-brand-icon"
              decoding="async"
            />
          </div>
        </div>

        <h1 class="login-heading">Create free account</h1>

        <form id="getstarted-form" novalidate>
          <div class="input-group">
            <label class="input-label" for="email">Email</label>
            <input
              id="email"
              class="input"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
            />
          </div>

          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label" for="password">Password</label>
            </div>

            <div class="password-wrap">
              <input
                id="password"
                class="input input-password"
                type="password"
                placeholder="••••••••"
                autocomplete="new-password"
              />

              <button
                id="toggle-password"
                class="toggle-password"
                type="button"
                aria-label="Show or hide password"
                aria-pressed="false"
              >
                <span class="eye-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <p id="getstarted-message" class="login-message" aria-live="polite"></p>

          <button id="submit-btn" class="btn btn-primary" type="submit">
            Create account
          </button>
        </form>

        <div class="register-wrapper">
          <button id="login-btn" class="btn btn-secondary" type="button">
            Login
          </button>
        </div>

        <div class="divider">
          <span class="divider-text">OR</span>
        </div>

        <div class="social-buttons">
          <button id="google-btn" class="gsi-material-button" style="width:197px;" type="button">
            <div class="gsi-material-button-state"></div>
            <div class="gsi-material-button-content-wrapper">
              <div class="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span class="gsi-material-button-contents">Continue with Google</span>
              <span style="display:none;">Continue with Google</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  `,L(),F(),I())}function M(e,t=!1){let n=document.querySelector(`#getstarted-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function N(){let e=document.querySelector(`#getstarted-message`);e&&(e.textContent=``,e.style.display=`none`)}function P(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#login-btn`);t&&(t.disabled=e,t.textContent=e?`Creating account...`:`Create account`),n&&(n.disabled=e),r&&(r.disabled=e)}function F(){let e=document.querySelector(`#login-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/login`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/auth/google/login`})}function I(){let e=document.querySelector(`#password`),t=document.querySelector(`#toggle-password`);!e||!t||t.addEventListener(`click`,()=>{let n=e.type===`password`;e.type=n?`text`:`password`,t.setAttribute(`aria-pressed`,String(n)),t.classList.toggle(`is-visible`,n),e.focus({preventScroll:!0});try{let t=e.value.length;e.setSelectionRange(t,t)}catch{}})}function L(){let e=document.querySelector(`#getstarted-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;N();let n=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,r=document.querySelector(`#password`)?.value??``;if(!n||!r){M(`Enter your email and password.`);return}t=!0,P(!0);try{let e=new URLSearchParams;e.set(`email`,n),e.set(`password`,r),window.location.href=`/register.html?${e.toString()}`}catch(e){console.error(e),M(`Could not continue to account creation.`)}finally{t=!1,P(!1)}})}document.querySelector(`#app`).innerHTML=`
  <div id="login-root"></div>
`,(window.location.pathname.replace(/\/+$/,``)||`/`)===`/getstarted`?j():S();