// Small, framework-free equivalents of the referenced component interactions.
const TripUI = (() => {
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const closing = new WeakSet();

  function icon(name) {
    return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="assets/icons/lucide.svg#${name}"></use></svg>`;
  }

  async function runBusy(button, action, controls = [button]) {
    if (button.hasAttribute('data-busy')) return;
    const previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    button.setAttribute('data-busy', '');
    button.setAttribute('aria-busy', 'true');
    try {
      return await action();
    } finally {
      controls.forEach((control, index) => { control.disabled = previous[index]; });
      button.removeAttribute('data-busy');
      button.removeAttribute('aria-busy');
    }
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    dialog.showModal();
    if (!reducedMotion()) {
      dialog.querySelector('.card').animate(
        [{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }

  async function closeDialog(dialog) {
    if (!dialog.open || closing.has(dialog)) return;
    closing.add(dialog);
    try {
      if (!reducedMotion()) {
        await dialog.querySelector('.card').animate(
          [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(0.98)' }],
          { duration: 130, easing: 'ease-in', fill: 'forwards' }
        ).finished;
      }
      dialog.close();
    } finally {
      dialog.querySelector('.card').getAnimations().forEach(animation => animation.cancel());
      closing.delete(dialog);
    }
  }

  return { icon, runBusy, openDialog, closeDialog };
})();
