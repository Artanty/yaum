import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LibraryApi } from '../core/library-api';
import { Session } from '../core/session';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly api = inject(LibraryApi);
  protected readonly session = inject(Session);

  protected readonly pendingImports = computed(() => this.api.me.value()?.pendingImports ?? 0);
  protected readonly unread = computed(() => this.api.me.value()?.unreadNotifications ?? 0);
  protected readonly librarySongs = computed(() => this.api.me.value()?.librarySongs ?? 0);
  protected readonly sharedWithMe = computed(() => this.api.me.value()?.sharedWithMe ?? 0);

  constructor() {
    // The user list is the switcher's options, so it has to be loaded before it can be rendered.
    effect(() => {
      const users = this.api.usersResource.value()?.users;
      if (users) this.session.setUsers(users);
    });
  }

  protected onSwitch(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.session.switchTo(value);
    // The badge counts and every list resource key off userId, but notifications do not, so a
    // forced refresh keeps the header honest the moment you switch.
    this.api.refresh();
  }
}
