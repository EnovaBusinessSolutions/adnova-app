

function showEl(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.removeAttribute('aria-hidden');
  el.style.display = el.classList.contains('content-panel') ? 'flex' : 'block';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (!el.style.position) el.style.position = 'relative';
  el.style.zIndex = '3';
}
function hideEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  el.style.visibility = 'hidden';
  el.style.opacity = '0';
  el.style.zIndex = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const $root = document.getElementById('onboarding') || document;

  const s1 = document.getElementById('step1-content');
  const s2 = document.getElementById('step2-content');

  const backBtn2 = document.getElementById('back-btn-2');
  const continueBtn2 = document.getElementById('continue-btn-2');

  
  $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  $root.querySelector('.step[data-step="2"]')?.classList.add('active');

 
  showEl(s2);
  hideEl(s1);

 
  backBtn2?.addEventListener('click', () => {
   
    window.location.href = '/onboarding.html#step=1';
  });

  continueBtn2?.addEventListener('click', () => {
    
    window.location.href = '/onboarding3.html';
  });

  
  if (location.hash && /step=1/.test(location.hash)) {
    
    $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    $root.querySelector('.step[data-step="1"]')?.classList.add('active');
    showEl(s1); hideEl(s2);
  } else {
    
    if (location.hash !== '#step=2') location.hash = '#step=2';
  }
});
