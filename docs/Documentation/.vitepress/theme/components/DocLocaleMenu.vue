<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useData, useRoute, withBase } from "vitepress";

import { getAlternateLink, getDocLocale, getLocaleLabel } from "../i18n";

const detailsRef = ref<HTMLDetailsElement | null>(null);
const { page, theme } = useData();
const route = useRoute();

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

watch(
  () => route.path,
  () => {
    detailsRef.value?.removeAttribute("open");
  }
);
</script>

<template>
  <details ref="detailsRef" class="DocLocaleMenu">
    <summary class="DocLocaleMenu__trigger" :aria-label="menuLabel">
      <span class="vpi-languages DocLocaleMenu__icon" aria-hidden="true" />
      <span class="DocLocaleMenu__label">{{ currentLabel }}</span>
      <span class="vpi-chevron-down DocLocaleMenu__chevron" aria-hidden="true" />
    </summary>

    <div class="DocLocaleMenu__panel">
      <a
        v-for="locale in localeLinks"
        :key="locale.href"
        class="DocLocaleMenu__item"
        :href="locale.href"
      >
        {{ locale.text }}
      </a>
    </div>
  </details>
</template>

<style scoped>
.DocLocaleMenu {
  position: relative;
  display: none;
  margin-left: 12px;
}

@media (min-width: 768px) {
  .DocLocaleMenu {
    display: block;
  }
}

.DocLocaleMenu__trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  list-style: none;
}

.DocLocaleMenu__trigger::-webkit-details-marker {
  display: none;
}

.DocLocaleMenu__icon,
.DocLocaleMenu__chevron {
  font-size: 16px;
}

.DocLocaleMenu__label {
  font-size: 14px;
  font-weight: 500;
}

.DocLocaleMenu[open] .DocLocaleMenu__chevron {
  transform: rotate(180deg);
}

.DocLocaleMenu__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 140px;
  padding: 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
}

.DocLocaleMenu__item {
  display: block;
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  text-decoration: none;
}

.DocLocaleMenu__item:hover {
  background: var(--vp-c-default-soft);
}
</style>
