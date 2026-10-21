import { frame } from '@expo/ui/swift-ui/modifiers';

/** iOS (SwiftUI) layout modifiers for the kit; Android: `layout.android.ts`. */
// A large maxWidth: the bridge cannot carry SwiftUI's `.infinity`.
export const fullWidth = [frame({ maxWidth: 10_000 })];
/** In a row, take the room the other children leave. */
export const grow = [frame({ maxWidth: 10_000, alignment: 'leading' })];
