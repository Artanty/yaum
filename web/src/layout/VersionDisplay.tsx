import { TAG_VERSION } from '../config';

/**
 * The deployed app version (the git tag CI baked in), shown small in the corner of the header —
 * the React counterpart of stat's `VersionDisplay`. `TAG_VERSION` is build-time config:
 * `src/config.ts` is overwritten from `.env` by the deploy workflow, and `'0.0.0.0'` is the
 * committed default for local/dev builds.
 */
export function VersionDisplay() {
  return (
    <span className="version" title="app version">
      {TAG_VERSION || '0.0.0.0'}
    </span>
  );
}
