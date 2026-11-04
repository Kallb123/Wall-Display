<script setup lang="ts">
// The foot of a preferences form: the unsaved flag, Discard and Save. Save is
// off until something has been edited.
defineProps<{
  dirty: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
  discard: []
}>()
</script>

<template>
  <div class="actions" role="group" aria-label="Actions">
    <p v-if="dirty" class="unsaved" data-testid="unsaved">
      <span class="unsaved-dot" aria-hidden="true" />
      Unsaved changes
    </p>
    <div class="end">
      <SettingsPillButton v-if="dirty" :disabled="saving" data-testid="discard" @click="emit('discard')">
        Discard
      </SettingsPillButton>
      <SettingsPillButton variant="primary" :disabled="!dirty || saving" data-testid="save" @click="emit('save')">
        {{ saving ? 'Saving…' : 'Save' }}
      </SettingsPillButton>
    </div>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.unsaved {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.unsaved-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}

.end {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
</style>
