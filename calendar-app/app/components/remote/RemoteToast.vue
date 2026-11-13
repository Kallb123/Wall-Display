<script setup lang="ts">
import { X } from 'lucide-vue-next'

// The toast that says a command failed, with a button to put it away.

defineProps<{
  message: string
}>()

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <div class="toast" role="status" data-testid="error">
    <span>{{ message }}</span>
    <button type="button" class="dismiss" aria-label="Dismiss" @click="emit('dismiss')">
      <AppIcon :icon="X" :size="22" />
    </button>
  </div>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.toast {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  left: max(16px, env(safe-area-inset-left));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: 448px;
  margin: 0 auto;
  padding: 4px 4px 4px 20px;
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  box-shadow: var(--shadow-lift);
  font-weight: 700;
}
</style>
