import type { CatalogFixes } from "./parse";

/**
 * Corrections to the owner's list, approved by the owner (#66). They're applied on every
 * conversion, so the original list converts to the same data; a fix whose line has gone from the
 * list fails the conversion. Codes are never changed: `11-L` is two perfumes, and the women's and
 * men's lists reuse codes for different perfumes.
 */
export const CATALOG_FIXES: CatalogFixes = {
  entries: [
    // Same names in both lists: the titles tell the women's and men's perfumes apart.
    { list: "women", storeCode: "2-H", sourceTitle: "Hugo Boss", title: "Hugo Boss Woman" },
    { list: "men", storeCode: "1-H", sourceTitle: "Hugo Boss", title: "Hugo Boss Man" },
    {
      list: "women",
      storeCode: "1-D",
      sourceTitle: "Davidoff Cool Water",
      title: "Davidoff Cool Water Woman",
    },
    {
      list: "men",
      storeCode: "2-D",
      sourceTitle: "Davidoff Cool Water",
      title: "Davidoff Cool Water Man",
    },
    {
      list: "men",
      storeCode: "11-J",
      sourceTitle: "Eclat D'Arpege",
      title: "Eclat D'Arpege Pour Homme",
    },
    // Typos in names and brands. The list writes Bvlgari with a Cyrillic "і".
    { list: "women", storeCode: "12-O", sourceTitle: "Omnia Bvlgarі", title: "Omnia Bvlgari" },
    {
      list: "women",
      storeCode: "4-P",
      sourceTitle: "Fame Poco Rabanne",
      title: "Fame Paco Rabanne",
    },
    {
      list: "women",
      storeCode: "1-V",
      sourceTitle: "Viktor Rolf Flowerbomb",
      brand: "Viktor&Rolf",
    },
    {
      list: "men",
      storeCode: "4-Y",
      sourceTitle: "Spisebomb",
      title: "Spicebomb",
      brand: "Viktor&Rolf",
    },
    { list: "men", storeCode: "1-X", sourceTitle: "Xeryus Rouge", brand: "Givenchy" },
    {
      list: "men",
      storeCode: "8-Z",
      sourceTitle: "Molecule 02 Escentric",
      title: "Molecule 02",
      brand: "Escentric Molecules",
    },
    {
      list: "men",
      storeCode: "4-G",
      sourceTitle: "Ganymede (Unisex)",
      brand: "Marc-Antoine Barrois",
    },
    { list: "men", storeCode: "1-A", sourceTitle: "Angel", title: "A*Men", brand: "Mugler" },
    {
      list: "men",
      storeCode: "3-G",
      sourceTitle: "Givenchy, Blue Label",
      title: "Givenchy Blue Label",
    },
    { list: "men", storeCode: "9-J", sourceTitle: "Angel's Share (Unisex)", brand: "Kilian" },
  ],
  familyAliases: {
    цитрус: "цитрусові",
    древовидні: "деревні",
  },
  noteSpelling: {
    іпельсин: "апельсин",
    перец: "перець",
    "рожевий перец": "рожевий перець",
    янтарь: "амбра",
    гардения: "гарденія",
    онов: "морські ноти",
    еламі: "елемі",
    вистери: "гліцинія",
    піон: "півонія",
    "перловий півонія": "перлова півонія",
    "деревинні ноти": "деревні ноти",
    деревний: "деревні ноти",
    мандарини: "мандарин",
    персики: "персик",
  },
};
