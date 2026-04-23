(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=[`/api/login`,`/login`,`/api/auth/login`];function t(e){return String(e||``).trim().toLowerCase()}function n(e){return String(e||``)}function r(e,r,i){let a={email:t(e),password:n(r)};return i&&String(i).trim()&&(a.turnstileToken=String(i).trim()),a}async function i(e){if((e.headers.get(`content-type`)||``).toLowerCase().includes(`application/json`))try{return await e.json()}catch{return null}try{let t=await e.text();return t?{success:e.ok,ok:e.ok,message:t}:null}catch{return null}}function a(e){return e?e.success===!0||e.ok===!0||e.authenticated===!0:!1}function o(e,t){return!!(t?.requiresCaptcha===!0||t?.code===`TURNSTILE_REQUIRED_OR_FAILED`||t?.code===`TURNSTILE_FAILED`||Array.isArray(t?.errorCodes)&&t.errorCodes.length>0||e.status===429&&t?.requiresCaptcha)}function s(e,t){return t?.message?t.message:t?.error?t.error:e.status===401?`Correo o contraseña incorrectos.`:e.status===403?`Tu correo aún no está verificado. Revisa tu bandeja de entrada.`:e.status===400?`No se pudo iniciar sesión.`:e.status>=500?`Error del servidor.`:`No se pudo iniciar sesión (HTTP ${e.status}).`}async function c(e,t,n,a){let o=r(t,n,a),s=await fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`},credentials:`include`,cache:`no-store`,body:JSON.stringify(o)});return{res:s,data:await i(s),endpoint:e}}async function l(t,n,r){let i=null;for(let a of e){let e=await c(a,t,n,r);if(i=e,!(e.res.status===404||e.res.status===405))return e}if(i)return i;throw Error(`No se encontró un endpoint de login disponible.`)}async function u(){let e=await fetch(`/api/session`,{credentials:`include`,cache:`no-store`});if(!e.ok)return null;try{return await e.json()}catch{return null}}function d(){try{let e=new URLSearchParams(window.location.search),t=e.get(`returnTo`)||e.get(`return_to`)||e.get(`next`);if(!t)return null;let n=decodeURIComponent(t);return!n.startsWith(`/`)||n.startsWith(`//`)||n.startsWith(`/\\`)?null:n}catch{return null}}async function f(){let e=0;for(;e<12;){let t=await u();if(t&&(t.authenticated||t.ok)){let e=d()||`/dashboard/`;return window.location.href=e,!0}await new Promise(e=>setTimeout(e,250)),e++}return!1}var p=null;function m(){return(document.querySelector(`meta[name="turnstile-site-key"]`)?.getAttribute(`content`)||``).trim()||(document.body?.dataset?.turnstileSitekey||``).trim()||(window.TURNSTILE_SITE_KEY||``).trim()||``}function h(){return(document.querySelector(`input[name="cf-turnstile-response"]`)?.value||``).trim()}function g(){let e=document.getElementById(`turnstile-wrap`);return e?e.style.display!==`none`:!1}function _(){let e=document.getElementById(`turnstile-wrap`);if(e)return e;let t=document.getElementById(`login-form`)||document.querySelector(`form`);e=document.createElement(`div`),e.id=`turnstile-wrap`,e.style.display=`none`,e.style.marginTop=`12px`,e.style.marginBottom=`8px`,e.style.justifyContent=`center`,e.style.alignItems=`center`,e.style.width=`100%`;let n=t?.querySelector(`button[type="submit"]`);return t&&n?.parentElement?n.parentElement.insertBefore(e,n):t?t.appendChild(e):document.body.appendChild(e),e}function v(){let e=document.getElementById(`turnstile-wrap`);e&&(e.style.display=`none`)}function y(){try{p==null?window.turnstile?.reset?.():window.turnstile?.reset?.(p)}catch{}}async function b(){return new Promise((e,t)=>{try{if(window.turnstile&&typeof window.turnstile.render==`function`){e();return}if(document.querySelector(`script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]`)){let n=0,r=window.setInterval(()=>{if(n+=1,window.turnstile&&typeof window.turnstile.render==`function`){window.clearInterval(r),e();return}n>50&&(window.clearInterval(r),t(Error(`Turnstile script no expuso window.turnstile a tiempo.`)))},100);return}let n=document.createElement(`script`);n.src=`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`,n.async=!0,n.defer=!0,n.onload=()=>{let n=0,r=window.setInterval(()=>{if(n+=1,window.turnstile&&typeof window.turnstile.render==`function`){window.clearInterval(r),e();return}n>50&&(window.clearInterval(r),t(Error(`Turnstile script cargó pero no expuso window.turnstile.`)))},100)},n.onerror=()=>t(Error(`No se pudo cargar Turnstile.`)),document.head.appendChild(n)}catch(e){t(e instanceof Error?e:Error(`Error cargando Turnstile.`))}})}async function x(){let e=m();if(!e)throw Error(`Falta configurar el Site Key de Turnstile.`);let t=_();t.style.display=`flex`,t.innerHTML=``;let n=document.createElement(`div`);n.id=`cf-turnstile-slot`,t.appendChild(n),await b(),p=window.turnstile?.render(n,{sitekey:e,size:`normal`,theme:`auto`,appearance:`always`,callback:()=>{},"expired-callback":()=>{try{p!=null&&window.turnstile?.reset?.(p)}catch{}},"error-callback":()=>{try{p!=null&&window.turnstile?.reset?.(p)}catch{}}})??null}var S=`/login-v2/assets/adray-icon-DLI0iEkk.png`;function C(){let e=document.querySelector(`#login-root`);e.innerHTML=`
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
      src="${S}"
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

          <div id="turnstile-wrap" style="display:none"></div>

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
<<<<<<<< HEAD:public/login-v2/assets/index-CsNSe2o0.js
  `,k(),D(),O(),A(),j()}function w(e,t=!1){let n=document.querySelector(`#login-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function T(){let e=document.querySelector(`#login-message`);e&&(e.textContent=``,e.style.display=`none`)}function E(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#register-btn`);t&&(t.disabled=e,t.textContent=e?`Signing in...`:`Sign in`),n&&(n.disabled=e),r&&(r.disabled=e)}function D(){let e=document.querySelector(`#register-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/getstarted`}),t&&t.addEventListener(`click`,()=>{let e=new URLSearchParams(window.location.search),t=e.get(`returnTo`)||e.get(`return_to`)||e.get(`next`),n=`/auth/google/login`;if(t)try{let e=decodeURIComponent(t);e.startsWith(`/`)&&!e.startsWith(`//`)&&!e.startsWith(`/\\`)&&(n=`/auth/google/login?returnTo=${encodeURIComponent(e)}`)}catch{}window.location.href=n})}function O(){let e=document.querySelector(`#password`),t=document.querySelector(`#toggle-password`);!e||!t||t.addEventListener(`click`,()=>{let n=e.type===`password`;e.type=n?`text`:`password`,t.setAttribute(`aria-pressed`,String(n)),t.classList.toggle(`is-visible`,n),e.focus({preventScroll:!0});try{let t=e.value.length;e.setSelectionRange(t,t)}catch{}})}async function k(){let e=document.querySelector(`#login-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;T();let n=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,r=document.querySelector(`#password`)?.value??``;if(!n||!r){w(`Enter your email and password.`);return}let i=g(),c=i?h():``;if(i&&!c){w(`Complete the security verification to continue.`);return}t=!0,E(!0);try{let{res:e,data:t}=await l(n,r,c||void 0);if(e.ok&&a(t)||e.ok&&t?.redirect){v(),await f()||w(`You signed in, but the session could not be confirmed.`);return}if(o(e,t)){try{await x(),w(`Verification required. Complete the captcha to continue.`)}catch(e){console.error(`[login] captcha error:`,e),v(),w(`Security verification could not be loaded. If you use Brave, uBlock, or privacy extensions, try disabling shields for this site and reload.`)}return}w(s(e,t))}catch(e){console.error(e),w(`Could not connect to the server.`)}finally{t=!1,E(!1)}})}async function A(){try{let e=await u();if(e&&(e.authenticated||e.ok)){let e=new URLSearchParams(window.location.search),t=e.get(`returnTo`)||e.get(`return_to`)||e.get(`next`),n=`/dashboard/`;if(t)try{let e=decodeURIComponent(t);e.startsWith(`/`)&&!e.startsWith(`//`)&&!e.startsWith(`/\\`)&&(n=e)}catch{}window.location.replace(n)}}catch{}}function j(){let e=new URLSearchParams(window.location.search);if(e.get(`verified`)!==`1`)return;w(`Email verified. You can sign in now.`,!0),e.delete(`verified`);let t=window.location.pathname+(e.toString()?`?${e.toString()}`:``)+window.location.hash;window.history.replaceState({},document.title,t)}function M(){let e=document.querySelector(`#login-root`);e&&(e.innerHTML=`
========
  `,O(),E(),D(),k(),A()}function C(e,t=!1){let n=document.querySelector(`#login-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function w(){let e=document.querySelector(`#login-message`);e&&(e.textContent=``,e.style.display=`none`)}function T(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#register-btn`);t&&(t.disabled=e,t.textContent=e?`Signing in...`:`Sign in`),n&&(n.disabled=e),r&&(r.disabled=e)}function E(){let e=document.querySelector(`#register-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/getstarted`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/auth/google/login`})}function D(){let e=document.querySelector(`#password`),t=document.querySelector(`#toggle-password`);!e||!t||t.addEventListener(`click`,()=>{let n=e.type===`password`;e.type=n?`text`:`password`,t.setAttribute(`aria-pressed`,String(n)),t.classList.toggle(`is-visible`,n),e.focus({preventScroll:!0});try{let t=e.value.length;e.setSelectionRange(t,t)}catch{}})}async function O(){let e=document.querySelector(`#login-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;w();let n=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,r=document.querySelector(`#password`)?.value??``;if(!n||!r){C(`Enter your email and password.`);return}let i=h(),c=i?m():``;if(i&&!c){C(`Complete the security verification to continue.`);return}t=!0,T(!0);try{let{res:e,data:t}=await l(n,r,c||void 0);if(e.ok&&a(t)||e.ok&&t?.redirect){_(),await d()||C(`You signed in, but the session could not be confirmed.`);return}if(o(e,t)){try{await b(),v(),C(`Verification required. Complete the captcha to continue.`)}catch(e){console.error(`[login] captcha error:`,e),C(`Security verification could not be loaded. Refresh the page and try again.`)}return}C(s(e,t))}catch(e){console.error(e),C(`Could not connect to the server.`)}finally{t=!1,T(!1)}})}async function k(){try{let e=await u();e&&(e.authenticated||e.ok)&&window.location.replace(`/dashboard/`)}catch{}}function A(){let e=new URLSearchParams(window.location.search);if(e.get(`verified`)!==`1`)return;C(`Email verified. You can sign in now.`,!0),e.delete(`verified`);let t=window.location.pathname+(e.toString()?`?${e.toString()}`:``)+window.location.hash;window.history.replaceState({},document.title,t)}function j(){let e=document.querySelector(`#login-root`);e&&(e.innerHTML=`
>>>>>>>> feature/attribution-react-refactor:public/login-v2/assets/index-CoGf83aI.js
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
              src="${S}"
              alt="Adray"
              class="login-brand-icon"
              decoding="async"
            />
          </div>
        </div>

        <h1 class="login-heading">Create free account</h1>

        <form id="getstarted-form" novalidate>
          <div class="input-group">
            <label class="input-label" for="name">Full name</label>
            <input
              id="name"
              class="input"
              type="text"
              placeholder="Your full name"
              autocomplete="name"
            />
          </div>

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
                placeholder="At least 8 characters"
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

          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label" for="confirm-password">Confirm password</label>
            </div>

            <div class="password-wrap">
              <input
                id="confirm-password"
                class="input input-password"
                type="password"
                placeholder="Repeat your password"
                autocomplete="new-password"
              />

              <button
                id="toggle-confirm-password"
                class="toggle-password"
                type="button"
                aria-label="Show or hide confirm password"
                aria-pressed="false"
              >
                <span class="eye-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <div id="turnstile-wrap" style="display:none"></div>

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
<<<<<<<< HEAD:public/login-v2/assets/index-CsNSe2o0.js
  `,z(),I(),L(`#password`,`#toggle-password`),L(`#confirm-password`,`#toggle-confirm-password`),B(),R())}function N(e,t=!1){let n=document.querySelector(`#getstarted-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function P(){let e=document.querySelector(`#getstarted-message`);e&&(e.textContent=``,e.style.display=`none`)}function F(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#login-btn`);t&&(t.disabled=e,t.textContent=e?`Creating account...`:`Create account`),n&&(n.disabled=e),r&&(r.disabled=e)}function I(){let e=document.querySelector(`#login-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/login`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/auth/google/login`})}function L(e,t){let n=document.querySelector(e),r=document.querySelector(t);!n||!r||r.addEventListener(`click`,()=>{let e=n.type===`password`;n.type=e?`text`:`password`,r.setAttribute(`aria-pressed`,String(e)),r.classList.toggle(`is-visible`,e),n.focus({preventScroll:!0});try{let e=n.value.length;n.setSelectionRange(e,e)}catch{}})}async function R(){try{await x()}catch(e){console.error(`[getstarted] captcha error:`,e),v(),N(`Security verification could not be loaded. If you use Brave, uBlock, or privacy extensions, try disabling shields for this site and reload.`)}}function z(){let e=document.querySelector(`#getstarted-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;P();let n=document.querySelector(`#name`)?.value.trim()||``,r=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,i=document.querySelector(`#password`)?.value??``,a=document.querySelector(`#confirm-password`)?.value??``;if(!n||!r||!i||!a){N(`Complete all fields to continue.`);return}if(n.length<2){N(`Enter your full name.`);return}if(i.length<8){N(`Password must be at least 8 characters.`);return}if(i!==a){N(`Passwords do not match.`);return}let o=h();if(!o){N(`Complete the security verification to continue.`);return}t=!0,F(!0);try{let e=await fetch(`/api/register`,{method:`POST`,headers:{"Content-Type":`application/json`},credentials:`include`,body:JSON.stringify({name:n,email:r,password:i,turnstileToken:o})}),t=await V(e),a=!!(t?.success??t?.ok);if(e.ok&&a){try{window.gtag?.(`event`,`sign_up`,{method:`email`})}catch{}v(),N(t.message||`Account created successfully. Check your email to verify your account.`,!0);let e=t.confirmUrl||`/confirmation.html?email=${encodeURIComponent(r)}`;window.setTimeout(()=>{window.location.href=e},900);return}(t?.code===`TURNSTILE_FAILED`||t?.code===`TURNSTILE_REQUIRED_OR_FAILED`||Array.isArray(t?.errorCodes)&&t.errorCodes.length>0||e.status===400)&&y(),N(t?.message||t?.error||(e.status===409?`This email is already registered.`:`Could not create your account. Please try again.`))}catch(e){console.error(e),y(),N(`Could not connect to the server.`)}finally{t=!1,F(!1)}})}async function B(){try{let e=await u();e&&(e.authenticated||e.ok)&&window.location.replace(`/dashboard/`)}catch{}}async function V(e){try{return await e.json()}catch{return{}}}function H(){let e=document.querySelector(`#login-root`);if(!e)return;let t=W();e.innerHTML=`
========
  `,R(),F(),I(`#password`,`#toggle-password`),I(`#confirm-password`,`#toggle-confirm-password`),z(),L())}function M(e,t=!1){let n=document.querySelector(`#getstarted-message`);n&&(n.textContent=e,n.style.display=`block`,n.style.color=t?`#f3f0ff`:`#fda4af`)}function N(){let e=document.querySelector(`#getstarted-message`);e&&(e.textContent=``,e.style.display=`none`)}function P(e){let t=document.querySelector(`#submit-btn`),n=document.querySelector(`#google-btn`),r=document.querySelector(`#login-btn`);t&&(t.disabled=e,t.textContent=e?`Creating account...`:`Create account`),n&&(n.disabled=e),r&&(r.disabled=e)}function F(){let e=document.querySelector(`#login-btn`),t=document.querySelector(`#google-btn`);e&&e.addEventListener(`click`,()=>{window.location.href=`/login`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/auth/google/login`})}function I(e,t){let n=document.querySelector(e),r=document.querySelector(t);!n||!r||r.addEventListener(`click`,()=>{let e=n.type===`password`;n.type=e?`text`:`password`,r.setAttribute(`aria-pressed`,String(e)),r.classList.toggle(`is-visible`,e),n.focus({preventScroll:!0});try{let e=n.value.length;n.setSelectionRange(e,e)}catch{}})}async function L(){try{await b(),v()}catch(e){console.error(`[getstarted] captcha error:`,e),M(`Security verification could not be loaded. Refresh the page and try again.`)}}function R(){let e=document.querySelector(`#getstarted-form`);if(!e)return;let t=!1;e.addEventListener(`submit`,async e=>{if(e.preventDefault(),t)return;N();let n=document.querySelector(`#name`)?.value.trim()||``,r=document.querySelector(`#email`)?.value.trim().toLowerCase()||``,i=document.querySelector(`#password`)?.value??``,a=document.querySelector(`#confirm-password`)?.value??``;if(!n||!r||!i||!a){M(`Complete all fields to continue.`);return}if(n.length<2){M(`Enter your full name.`);return}if(i.length<8){M(`Password must be at least 8 characters.`);return}if(i!==a){M(`Passwords do not match.`);return}let o=m();if(!o){M(`Complete the security verification to continue.`);return}t=!0,P(!0);try{let e=await fetch(`/api/register`,{method:`POST`,headers:{"Content-Type":`application/json`},credentials:`include`,body:JSON.stringify({name:n,email:r,password:i,turnstileToken:o})}),t=await B(e),a=!!(t?.success??t?.ok);if(e.ok&&a){try{window.gtag?.(`event`,`sign_up`,{method:`email`})}catch{}_(),M(t.message||`Account created successfully. Check your email to verify your account.`,!0);let e=t.confirmUrl||`/confirmation.html?email=${encodeURIComponent(r)}`;window.setTimeout(()=>{window.location.href=e},900);return}(t?.code===`TURNSTILE_FAILED`||t?.code===`TURNSTILE_REQUIRED_OR_FAILED`||Array.isArray(t?.errorCodes)&&t.errorCodes.length>0||e.status===400)&&v(),M(t?.message||t?.error||(e.status===409?`This email is already registered.`:`Could not create your account. Please try again.`))}catch(e){console.error(e),v(),M(`Could not connect to the server.`)}finally{t=!1,P(!1)}})}async function z(){try{let e=await u();e&&(e.authenticated||e.ok)&&window.location.replace(`/dashboard/`)}catch{}}async function B(e){try{return await e.json()}catch{return{}}}function V(){let e=document.querySelector(`#login-root`);if(!e)return;let t=U();e.innerHTML=`
>>>>>>>> feature/attribution-react-refactor:public/login-v2/assets/index-CoGf83aI.js
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
      <div class="login-card confirmation-card">
        <div class="login-card-glow" aria-hidden="true"></div>
        <div class="login-card-noise" aria-hidden="true"></div>
        <div class="login-card-aurora" aria-hidden="true"></div>

        <div class="login-topbar login-topbar--minimal">
          <div class="login-brand-icon-wrap" aria-hidden="true">
            <img
              src="${S}"
              alt="Adray"
              class="login-brand-icon"
              decoding="async"
            />
          </div>
        </div>

        <div class="confirmation-shell">
          <div class="confirmation-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" class="confirmation-badge-svg">
              <path
                d="M3.75 7.5L10.94 12.533c.636.445.954.667 1.291.753a2.25 2.25 0 0 0 1.038 0c.337-.086.655-.308 1.291-.753L21.75 7.5"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M6.45 19.5h11.1c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311c.327-.642.327-1.482.327-3.162V9.3c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C20.07 4.5 19.23 4.5 17.55 4.5H6.45c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C1.65 6.78 1.65 7.62 1.65 9.3v5.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C3.93 19.5 4.77 19.5 6.45 19.5Z"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <div class="confirmation-copy">
            <p class="confirmation-kicker">EMAIL VERIFICATION</p>

            <h1 class="confirmation-title">Confirm your email</h1>

            <p class="confirmation-lead">
              We sent a verification link to your email address.
            </p>

            ${t?`<div class="confirmation-email-pill">${K(t)}</div>`:``}

            <p class="confirmation-body">
              Open your inbox and click the verification link to activate your account and continue.
            </p>

            <p class="confirmation-footnote">
              If you don’t see it, check your spam, promotions, or junk folder.
            </p>
          </div>

          <div class="confirmation-actions">
            <button id="open-mail-btn" class="btn btn-primary" type="button">
              Open email
            </button>

            <button id="go-login-btn" class="btn btn-secondary" type="button">
              Go to login
            </button>
          </div>
        </div>
      </div>
    </div>
  `,U()}function U(){let e=document.querySelector(`#open-mail-btn`),t=document.querySelector(`#go-login-btn`);e&&e.addEventListener(`click`,()=>{let e=G(W());if(e){window.open(e,`_blank`,`noopener,noreferrer`);return}window.location.href=`/login`}),t&&t.addEventListener(`click`,()=>{window.location.href=`/login`})}function W(){return(new URLSearchParams(window.location.search).get(`email`)||``).trim()}function G(e){let t=e.toLowerCase();return!t||t.includes(`@gmail.com`)||t.includes(`@googlemail.com`)?`https://mail.google.com`:t.includes(`@outlook.com`)||t.includes(`@hotmail.com`)||t.includes(`@live.com`)||t.includes(`@msn.com`)?`https://outlook.live.com/mail/`:t.includes(`@icloud.com`)||t.includes(`@me.com`)||t.includes(`@mac.com`)?`https://www.icloud.com/mail`:t.includes(`@yahoo.com`)?`https://mail.yahoo.com`:``}function K(e){return e.replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`).replaceAll(`'`,`&#39;`)}document.querySelector(`#app`).innerHTML=`
  <div id="login-root"></div>
`;var q=window.location.pathname.replace(/\/+$/,``)||`/`;q===`/getstarted`?M():q===`/confirmation`?H():C();