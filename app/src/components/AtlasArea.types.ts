import type { AtlasBounds } from '../lib/atlasGeometry';

export interface AtlasAreaProps {
  initialBounds: AtlasBounds;
  disabled?: boolean;
  /** Increment to bring the current selection back into view without changing it. */
  fitRequest?: number;
  onChange(bounds: AtlasBounds): void;
}
