import type { RemoteInfo } from '../../../shared/remote'

// Whether the command routes need a PIN, so the remote page knows whether to
// ask for one. Never the PIN itself.
export default defineEventHandler((): RemoteInfo => {
  return { pin_required: useConfig().remote?.pin !== undefined }
})
