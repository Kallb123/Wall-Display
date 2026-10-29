// Checks the PIN in the `x-wallcal-pin` header and does nothing else: 204 if it
// is right (or none is set), 401 or 429 as the command routes answer. The
// remote page uses it to check a PIN as it is typed in.
export default defineEventHandler((event) => {
  requireRemotePin(event)
  setResponseStatus(event, 204)
  return null
})
