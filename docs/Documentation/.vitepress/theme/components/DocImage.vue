<script setup lang="ts">
withDefaults(
  defineProps<{
    src: string;
    alt: string;
    caption?: string;
    maxWidth?: string;
  }>(),
  {
    caption: "",
    maxWidth: "960px"
  }
);
</script>

<template>
  <figure class="doc-image" :style="{ maxWidth }">
    <div class="doc-image__frame">
      <img :src="src" :alt="alt" loading="lazy" />
    </div>
    <figcaption v-if="caption" class="doc-image__caption">
      {{ caption }}
    </figcaption>
  </figure>
</template>
