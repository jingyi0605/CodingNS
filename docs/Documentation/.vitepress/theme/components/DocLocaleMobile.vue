<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

import { getAlternateLink, getDocLocale, getLocaleLabel } from "../i18n";

const { page, theme } = useData();

const currentLocale = computed(() => getDocLocale(page.value.relativePath));
const currentLabel = computed(() => getLocaleLabel(currentLocale.value));
const menuLabel = computed(() => theme.value.langMenuLabel || "语言");

const localeLinks = computed(() => {
  const targetLocale = currentLocale.value === "zh" ? "en" : "zh";

  return [
    {
      text: getLocaleLabel(targetLocale),
      href: withBase(getAlternateLink(page.value.relativePath, targetLocale))
    }
  ];
});
</script>

<template>
  <div class="DocLocaleMobile">
    <p class="DocLocaleMobile__title">
      <span class="vpi-languages" aria-hidden="true" />
      {{ menuLabel }}
      <span class="DocLocaleMobile__current">{{ currentLabel }}</span>
    </p>

    <a
      v-for="locale in localeLinks"
      :key="locale.href"
      class="DocLocaleMobile__item"
      :href="locale.href"
    >
      {{ locale.text }}
    </a>
  </div>
</template>

<style scoped>
.DocLocaleMobile {
  padding: 12px 24px 0;
}

@media (min-width: 768px) {
  .DocLocaleMobile {
    display: none;
  }
}

.DocLocaleMobile__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
}

.DocLocaleMobile__current {
  margin-left: auto;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.DocLocaleMobile__item {
  display: block;
  padding: 8px 0 8px 24px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  text-decoration: none;
}
</style>
