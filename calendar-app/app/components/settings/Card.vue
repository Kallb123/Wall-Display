<template>
  <article class="card">
    <slot />
  </article>
</template>

<style scoped>
/* The settings pages' card: the remote's, with the roomier padding of a bigger screen. */
.card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 32px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}
</style>
