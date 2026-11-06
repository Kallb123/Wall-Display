<script setup lang="ts">
import { renderSVG } from 'uqr'
import { canOfferInstall, displayLink } from '~/utils/settings'

// "Open on another device" (architecture §7.6): the link to a display's page,
// as a QR code to scan with a phone or tablet, and what to expect from it. The
// address is the one this page was opened on, so it works from where the
// person is sitting. The code is drawn dark on white in both themes, because
// a phone's camera reads it that way round.
const props = defineProps<{
  id: string
  name: string
}>()

const link = computed(() => displayLink(location.origin, props.id))
// Medium error correction and a two-module quiet zone: enough for a screen, and the code stays small.
const qr = computed(() => `data:image/svg+xml,${encodeURIComponent(renderSVG(link.value, { ecc: 'M', border: 2 }))}`)
const installable = canOfferInstall(location)
</script>

<template>
  <section class="device" aria-label="Open on another device" data-testid="display-device">
    <div class="text">
      <h3 class="subhead">
        Open on another device
      </h3>
      <a class="link" :href="link" target="_blank" rel="noopener" data-testid="display-link">{{ link }}</a>
      <p class="note">
        The device mirrors this display: the same view, dimming and screen off. It shows under Wall page in Connections. To show something different on a demo device, add a display for it in <code>displays:</code> in the config.
      </p>
      <p v-if="!installable" class="note warning" data-testid="display-install-note">
        Installing the display as an app needs HTTPS (the local HTTPS address) or <code>localhost</code>. Over plain HTTP like this, the browser won't offer Install from this link.
      </p>
    </div>
    <img class="qr" :src="qr" width="160" height="160" :alt="`QR code for the ${name} display's link`" data-testid="display-qr">
  </section>
</template>

<style scoped>
.device {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  padding: 20px 24px;
  border-radius: 24px;
  background: var(--bg);
}

.text {
  flex: 1;
  min-width: min(100%, 260px);
}

.subhead {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.link {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--accent-ink);
  font-size: 17px;
  font-weight: 700;
}

.note {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.warning {
  color: var(--accent-ink);
}

code {
  font-family: inherit;
  font-weight: 700;
}

/* White whatever the theme, with the code's own quiet zone, so a phone can read it. */
.qr {
  flex: none;
  border-radius: 12px;
  background: #fff;
}
</style>
