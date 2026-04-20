<script setup lang="ts">
import DefaultTheme from "vitepress/theme";

import DocLocaleMenu from "./components/DocLocaleMenu.vue";
import DocLocaleMobile from "./components/DocLocaleMobile.vue";
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-content-after>
      <DocLocaleMenu />
    </template>

    <template #nav-screen-content-after>
      <DocLocaleMobile />
    </template>
  </DefaultTheme.Layout>
</template>
