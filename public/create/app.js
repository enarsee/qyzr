document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const heroFile = fd.get('hero_image');
  fd.delete('hero_image');
  const body = Object.fromEntries(fd.entries());

  // Upload hero image first (if provided), then create quiz with the resulting path.
  if (heroFile && heroFile.size > 0) {
    const heroFd = new FormData(); heroFd.append('image', heroFile);
    const up = await fetch('/api/upload', { method: 'POST', body: heroFd });
    if (!up.ok) {
      document.getElementById('err').textContent = 'Hero image upload failed';
      return;
    }
    body.hero_image_path = (await up.json()).path;
  }

  const res = await fetch('/api/quiz', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    document.getElementById('err').textContent = j.error || 'Something went wrong';
    return;
  }
  const j = await res.json();
  // Persist creator URL in localStorage
  const list = JSON.parse(localStorage.getItem('wq_creator_urls') || '[]');
  list.unshift({ name: body.name, host_url: j.host_url, room_code: j.room_code, created_at: Date.now() });
  localStorage.setItem('wq_creator_urls', JSON.stringify(list.slice(0, 20)));
  // Append ?fresh=1 so the host page knows to show the "save this link" banner.
  const sep = j.host_url.includes('?') ? '&' : '?';
  window.location.href = j.host_url + sep + 'fresh=1';
});
