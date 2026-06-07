import { iconSvg, renderModal, renderPandaEyes, renderStatusStrip } from './render.js';

export function renderLoginShell(root) {
  root.innerHTML = `<section class="login-shell">
    <section class="panda-visual-stage login-stage">${renderPandaEyes({ mode: 'watch' })}<div id="accessGranted" class="access-granted" aria-live="polite">Access Granted</div></section>
    <aside class="login-panel" aria-label="Secure service access">
      <form id="loginForm" class="login-form" novalidate>
        <p class="panel-kicker">SECURE SERVICE ACCESS</p>
        <h2>Welcome Back</h2>
        <p class="panel-subtitle">Sign in to open PANDA Service Radar</p>
        <div class="field-group">
          <label for="usernameInput">Username</label>
          <div class="input-shell">${iconSvg('user')}<input id="usernameInput" name="username" autocomplete="username" spellcheck="false" aria-describedby="usernameError"></div>
          <small id="usernameError" class="validation-message" aria-live="polite"></small>
        </div>
        <div class="field-group">
          <label for="passwordInput">Password</label>
          <div class="input-shell password-shell">${iconSvg('lock')}<input id="passwordInput" name="password" type="password" autocomplete="current-password" aria-describedby="passwordError"><button id="togglePassword" type="button" class="password-toggle" aria-label="Show password" aria-pressed="false">${iconSvg('eye')}</button></div>
          <small id="passwordError" class="validation-message" aria-live="polite"></small>
        </div>
        <div class="login-options"><label class="check-line"><input id="rememberInput" type="checkbox"> Remember me</label><button id="forgotPassword" type="button" class="link-button">Forgot password</button></div>
        <button id="signInButton" class="primary login-submit" type="submit"><span class="button-label">Sign In</span><span class="button-loading">Authenticating…</span></button>
        <small id="loginMessage" class="validation-message form-message" aria-live="assertive"></small>
      </form>
    </aside>
  </section>
  ${renderStatusStrip([['System Status','Operational'],['Data Source','Awaiting Upload'],['Analysis Engine','PANDA Core'],['Session Security','Local Prototype Session']])}
  ${renderModal({ id: 'forgotModal', title: 'Password recovery is not connected', body: 'This local prototype does not connect to a secure password recovery service. Production authentication must be handled by a backend identity system.' })}`;
}

export function setLoginAuthenticating(loading) {
  ['usernameInput', 'passwordInput', 'rememberInput', 'signInButton', 'togglePassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = loading;
  });
  document.getElementById('loginForm')?.classList.toggle('auth-loading', loading);
}

export function renderLoginValidation({ errors = {}, message = '', touched = {}, submitted = false } = {}) {
  const showUser = submitted || touched.username;
  const showPass = submitted || touched.password;
  const usernameError = showUser ? errors.username || '' : '';
  const passwordError = showPass ? errors.password || '' : '';
  document.getElementById('usernameError').textContent = usernameError;
  document.getElementById('passwordError').textContent = passwordError;
  document.getElementById('loginMessage').textContent = message || '';
  document.getElementById('usernameInput').classList.toggle('invalid', !!usernameError);
  document.getElementById('passwordInput').classList.toggle('invalid', !!passwordError);
}

export function setAccessGranted(active) {
  document.querySelector('.login-shell')?.classList.toggle('access-is-granted', active);
  document.getElementById('accessGranted')?.classList.toggle('visible', active);
}
