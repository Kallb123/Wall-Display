// sharp is a native module and loads slowly, so it is read when the first photo
// needs it, not at boot (as for the special day art). Cached by the module system.
export async function loadSharp() {
  return (await import('sharp')).default
}
