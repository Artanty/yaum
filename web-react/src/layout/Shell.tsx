import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import './shell.scss';
import { useLibraryApi } from '../core/library-api';
import { useSession } from '../core/session';

/** routerLinkActive="on" — a section stays lit on its detail pages too (`end` defaults to false). */
const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : undefined);

export function Shell({ children }: { children: ReactNode }) {
  const api = useLibraryApi();
  const session = useSession();

  const pendingImports = api.me.data?.pendingImports ?? 0;
  const unread = api.me.data?.unreadNotifications ?? 0;
  const librarySongs = api.me.data?.librarySongs ?? 0;
  const sharedWithMe = api.me.data?.sharedWithMe ?? 0;

  const users = api.users.data?.users;
  const setUsers = session.setUsers;

  // The user list is the switcher's options, so it has to be loaded before it can be rendered.
  useEffect(() => {
    if (users) setUsers(users);
  }, [users, setUsers]);

  const onSwitch = (value: number) => {
    session.switchTo(value);
    // The badge counts and every list resource key off userId, but notifications do not, so a
    // forced refresh keeps the header honest the moment you switch.
    api.refresh();
  };

  return (
    <div className="shell">
      <header className="bar">
        <Link className="brand" to="/library">
          plst<span>library</span>
        </Link>

        <nav>
          <NavLink className={navClass} to="/library">
            Library
          </NavLink>
          <NavLink className={navClass} to="/imports">
            Imports
            {pendingImports > 0 && (
              <span className="badge warn" aria-label={`${pendingImports} pending imports`}>
                {pendingImports}
              </span>
            )}
          </NavLink>
          <NavLink className={navClass} to="/playlists">
            Playlists
            {sharedWithMe > 0 && (
              <span className="badge" aria-label={`${sharedWithMe} shared with you`}>
                {sharedWithMe}
              </span>
            )}
          </NavLink>
          <NavLink className={navClass} to="/notifications">
            Alerts
            {unread > 0 && (
              <span className="badge" aria-label={`${unread} unread notifications`}>
                {unread}
              </span>
            )}
          </NavLink>
        </nav>

        <div className="spacer" />

        <span className="stat" title="songs in the library">
          {librarySongs} songs
        </span>

        {/* No login yet: picking a user here IS the login, and the backend trusts the x-user-id header. */}
        <label className="switcher">
          <span className="sr">acting as</span>
          <select value={session.userId} onChange={(e) => onSwitch(Number(e.target.value))}>
            {session.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name || u.username}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main>{children}</main>

      {pendingImports > 0 && (
        <div className="toast" role="status">
          {pendingImports} scan{pendingImports === 1 ? '' : 's'} waiting — turn{' '}
          {pendingImports === 1 ? 'it' : 'them'} into a playlist <Link to="/imports">open</Link>
        </div>
      )}
    </div>
  );
}
