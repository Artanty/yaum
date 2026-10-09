/** Formatting helpers, ported from the React/Angular apps. */

export function artistsText(song) {
  return (song.artists ?? []).map((a) => a.name).join(', ');
}

export function artistCredit(song) {
  const artists = song.artists ?? [];
  const main = artists.filter((a) => a.role === 'main');
  if (!main.length) return artistsText(song);
  const feat = artists.filter((a) => a.role !== 'main');
  const head = main.map((a) => a.name).join(', ');
  return feat.length ? `${head} feat. ${feat.map((a) => a.name).join(', ')}` : head;
}

export function durationText(seconds) {
  if (!seconds || seconds < 0) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function timeAgo(unixSeconds) {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function notificationText(n) {
  const who = n.actor_username ?? 'someone';
  const what = n.playlist_name ? `“${n.playlist_name}”` : 'a playlist';
  switch (n.type) {
    case 'playlist_shared':
      return `${who} shared ${what} with you`;
    case 'playlist_renamed':
      return `${who} renamed ${what} to “${payloadName(n)}”`;
    case 'playlist_edited':
      return `${who} edited ${what}`;
    case 'collab_removed':
      return `${who} removed your access to ${what}`;
    case 'import_ready':
      return 'a scan is waiting to be turned into a playlist';
    default:
      return `${who} did something in ${what}`;
  }
}

function payloadName(n) {
  const p = n.payload;
  return typeof p?.name === 'string' ? p.name : '(renamed)';
}
