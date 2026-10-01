import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LibraryApi } from '../../core/library-api';
import { artistCredit, durationText, plural, timeAgo } from '../../core/format';

@Component({
  selector: 'app-library-page',
  imports: [FormsModule],
  templateUrl: './library.html',
  styleUrl: './library.scss',
})
export class LibraryPage {
  protected readonly api = inject(LibraryApi);
  protected readonly artistCredit = artistCredit;
  protected readonly durationText = durationText;
  protected readonly timeAgo = timeAgo;
  protected readonly plural = plural;

  protected readonly page = LibraryApi.PAGE;
  protected readonly songs = this.api.songs;
  protected readonly genres = this.api.genres;
  protected readonly artists = this.api.artists;
  protected readonly albums = this.api.albums;

  protected readonly total = computed(() => this.songs.value()?.total ?? 0);
  protected readonly from = computed(() => (this.total() === 0 ? 0 : this.api.offset() + 1));
  protected readonly to = computed(() => Math.min(this.api.offset() + this.page, this.total()));

  protected readonly hasFilters = computed(
    () => !!this.api.query().trim() || !!this.api.albumFilter() || !!this.api.artistFilter() || !!this.api.genreFilter(),
  );

  protected get search(): string {
    return this.api.query();
  }
  protected set search(v: string) {
    this.api.query.set(v);
    this.api.offset.set(0);
  }

  protected filterAlbum(id: number | null): void {
    this.api.albumFilter.set(this.api.albumFilter() === id ? null : id);
    this.api.offset.set(0);
  }

  protected filterArtist(id: number | null): void {
    this.api.artistFilter.set(this.api.artistFilter() === id ? null : id);
    this.api.offset.set(0);
  }

  protected filterGenre(id: number | null): void {
    this.api.genreFilter.set(this.api.genreFilter() === id ? null : id);
    this.api.offset.set(0);
  }

  protected clear(): void {
    this.api.query.set('');
    this.api.albumFilter.set(null);
    this.api.artistFilter.set(null);
    this.api.genreFilter.set(null);
    this.api.offset.set(0);
  }

  protected next(): void {
    if (this.to() < this.total()) this.api.offset.update((o) => o + this.page);
  }

  protected prev(): void {
    this.api.offset.update((o) => Math.max(0, o - this.page));
  }
}
