import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'library' },
  {
    path: 'library',
    loadComponent: () => import('./pages/library/library').then((m) => m.LibraryPage),
    title: 'Library — yaum',
  },
  {
    path: 'imports',
    loadComponent: () => import('./pages/imports/imports').then((m) => m.ImportsPage),
    title: 'Imports — yaum',
  },
  {
    path: 'playlists',
    loadComponent: () => import('./pages/playlists/playlists').then((m) => m.PlaylistsPage),
    title: 'Playlists — yaum',
  },
  {
    path: 'playlists/:id',
    loadComponent: () => import('./pages/playlist-detail/playlist-detail').then((m) => m.PlaylistDetailPage),
    title: 'Playlist — yaum',
  },
  {
    path: 'notifications',
    loadComponent: () => import('./pages/notifications/notifications').then((m) => m.NotificationsPage),
    title: 'Alerts — yaum',
  },
  { path: '**', redirectTo: 'library' },
];
