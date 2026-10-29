// Checks the PIN in the `x-wallcal-pin` header and does nothing else: 204 if it
// is right (or none is set), 401 or 429 as every write route answers. The PIN
// middleware has already done the checking by the time this runs, so all that
// is left is the 204. The remote page uses it to check a PIN as it is typed in.
export default defineEventHandler((event) => {
  setResponseStatus(event, 204)
  return null
})
