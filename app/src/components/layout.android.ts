import { fillMaxWidth, weight } from '@expo/ui/jetpack-compose/modifiers';

/** Android (Compose) layout modifiers for the kit; iOS: `layout.ts`. */
export const fullWidth = [fillMaxWidth()];
/** In a row, take the room the other children leave. */
export const grow = [weight(1)];
