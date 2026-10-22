// Single source of truth for which topic files are ready to use, shared by app.js (browser) and server.mjs (Node).
// Leave empty to make every loaded topic available. Use topic file IDs such as "01", "08-1", or "10".
export const AVAILABLE_TOPICS = [
  "01-zahalni-polozhennya",
  "02-obov-yazky-i-prava-vodiyiv-mekhanichnykh-transportnykh-zasobiv",
  "03-rukh-transportnykh-zasobiv-iz-spetsialnymy-syhnalamy",
  "04-obov-yazky-i-prava-pishokhodiv",
  "05-obov-yazky-i-prava-pasazhyriv",
  "06-vymohy-do-velosypedystiv",
  "07-vymohy-do-osib-yaki-keruyut-huzhovym-transportom-i-pohonychiv-tvaryn",
  "08-1-rehulyuvannya-dorozhnoho-rukhu-rehulovani-perekhrestya",
  "09-2-rehulyuvannya-dorozhnoho-rukhu-nerehulovani-perekhrestya",
  "10-poperedzhuvalni-syhnaly",
  "11-pochatok-rukhu-ta-zmina-yoho-napryamku",
  "12-roztashuvannya-transportnykh-zasobiv-na-dorozi",
  "13-shvydkist-rukhu",
  "14-dystantsiya-interval-zustrichnyy-roz-yizd",
  "15-obhin",
  "16-zupynka-i-stoyanka",
  "17-1-proyizd-perekhrest-rehulovani-perekhrestya",
  "18-2-proyizd-perekhrest-nerehulovani-perekhrestya",
  "19-perevahy-marshrutnykh-transportnykh-zasobiv",
  "20-proyizd-pishokhidnykh-perekhodiv-i-zupynok-transportnykh-zasobiv",
  "21-korystuvannya-zovnishnimy-svitlovymy-pryladamy",
  "22-rukh-cherez-zaliznychni-pereyizdy",
  "23-perevezennya-pasazhyriv",
  "24-perevezennya-vantazhu",
  "25-buksyruvannya-ta-ekspluatatsiya-transportnykh-sostaviv",
  "26-navchalna-yizda",
  "27-rukh-transportnykh-zasobiv-u-kolonakh",
  "28-rukh-u-zhytloviy-ta-pishokhidniy-zoni",
  "29-rukh-po-avtomahistralyakh",
  "30-rukh-po-hirskykh-dorohakh-i-na-krutykh-spuskakh",
  "31-mizhnarodnyy-rukh",
  "32-nomerni-rozpiznavalni-znaky-napysy-i-poznachennya",
  "33-tekhnichnyy-stan-transportnykh-zasobiv-ta-yikh-obladnannya",
  "34-okremi-pytannya-dorozhnoho-rukhu-shcho-potrebuyut-uzhodzhennya",
  "35-1-poperedzhuvalni-znaky",
  "35-2-znaky-priorytetu",
  "35-3-zaboronni-znaky",
  "35-4-nakazovi-znaky",
  "35-5-informatsiyno-vkazivni-znaky",
  "35-6-znaky-servisu",
  "35-7-tablychky-do-dorozhnikh-znakiv",
  "36-dorozhnya-rozmitka",

  "37-osnovy-bezpechnoho-vodinnya",
  "41-osnovy-prava-v-oblasti-dorozhnoho-rukhu",
  "42-nadannya-domedychnoyi-dopomohy",
  "43-etyka-vodinnya-kultura-ta-vidpochynok-vodiya",
  "44-yevroprotokol",
  "45-dodatkovi-pytannya-shchodo-katehoriy-a1-a-zahalni",
  "46-dodatkovi-pytannya-shchodo-katehoriy-a1-a-budova-i-terminy",
  "47-dodatkovi-pytannya-shchodo-katehoriy-a1-a-yurydychna-vidpovidalnist",
  "48-dodatkovi-pytannya-shchodo-katehoriy-a1-a-bezpeka",
  "49-dodatkovi-pytannya-shchodo-katehoriy-v1-v-zahalni",
  "50-dodatkovi-pytannya-shchodo-katehoriy-v1-v-budova-i-terminy",
  "51-dodatkovi-pytannya-shchodo-katehoriy-v1-v-yurydychna-vidpovidalnist",
  "52-dodatkovi-pytannya-shchodo-katehoriy-v1-v-bezpeka",

  "53-dodatkovi-pytannya-shchodo-katehoriy-c1-c-zahalni",
  "54-dodatkovi-pytannya-shchodo-katehoriy-c1-c-budova-i-terminy",
  "55-dodatkovi-pytannya-shchodo-katehoriy-c1-c-yurydychna-vidpovidalnist",
  "56-dodatkovi-pytannya-shchodo-katehoriy-c1-c-bezpeka",
  "57-dodatkovi-pytannya-shchodo-katehoriy-d1-d-zahalni",
  "58-dodatkovi-pytannya-shchodo-katehoriy-d1-d-budova-i-terminy",
  "59-dodatkovi-pytannya-shchodo-katehoriy-d1-d-yurydychna-vidpovidalnist",
  "60-dodatkovi-pytannya-shchodo-katehoriy-d1-d-bezpeka",

  "61-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-zahalni",
  "62-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-budova-y-terminy",
  "63-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-yurydychna-vidpovilnist",
  "64-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-bezpeka",
  "65-dodatkovi-pytannya-shchodo-katehoriyi-t-zahalni",
  "66-dodatkovi-pytannya-shchodo-katehoriyi-t-budova-i-terminy",
  "67-dodatkovi-pytannya-shchodo-katehoriyi-t-yurydychna-vidpovilnist",
  "68-dodatkovi-pytannya-shchodo-katehoriyi-t-bezpeka"
];

export const RANDOM_TEST_CATEGORIES = {
  a: {
    label: "A, A1",
    topicIds: [
      "45-dodatkovi-pytannya-shchodo-katehoriy-a1-a-zahalni",
      "46-dodatkovi-pytannya-shchodo-katehoriy-a1-a-budova-i-terminy",
      "47-dodatkovi-pytannya-shchodo-katehoriy-a1-a-yurydychna-vidpovidalnist",
      "48-dodatkovi-pytannya-shchodo-katehoriy-a1-a-bezpeka"
    ]
  },
  b: {
    label: "B, B1",
    topicIds: [
      "49-dodatkovi-pytannya-shchodo-katehoriy-v1-v-zahalni",
      "50-dodatkovi-pytannya-shchodo-katehoriy-v1-v-budova-i-terminy",
      "51-dodatkovi-pytannya-shchodo-katehoriy-v1-v-yurydychna-vidpovidalnist",
      "52-dodatkovi-pytannya-shchodo-katehoriy-v1-v-bezpeka"
    ]
  },
  c: {
    label: "C, C1",
    topicIds: [
      "53-dodatkovi-pytannya-shchodo-katehoriy-c1-c-zahalni",
      "54-dodatkovi-pytannya-shchodo-katehoriy-c1-c-budova-i-terminy",
      "55-dodatkovi-pytannya-shchodo-katehoriy-c1-c-yurydychna-vidpovidalnist",
      "56-dodatkovi-pytannya-shchodo-katehoriy-c1-c-bezpeka"
    ]
  },
  d: {
    label: "D, D1",
    topicIds: [
      "57-dodatkovi-pytannya-shchodo-katehoriy-d1-d-zahalni",
      "58-dodatkovi-pytannya-shchodo-katehoriy-d1-d-budova-i-terminy",
      "59-dodatkovi-pytannya-shchodo-katehoriy-d1-d-yurydychna-vidpovidalnist",
      "60-dodatkovi-pytannya-shchodo-katehoriy-d1-d-bezpeka"
    ]
  },
  e: {
    label: "BE, C1E, CE, D1E, DE",
    topicIds: [
      "61-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-zahalni",
      "62-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-budova-y-terminy",
      "63-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-yurydychna-vidpovilnist",
      "64-dodatkovi-pytannya-shchodo-katehoriy-be-c1e-ce-d1e-de-bezpeka"
    ]
  },
  t: {
    label: "T",
    topicIds: [
      "65-dodatkovi-pytannya-shchodo-katehoriyi-t-zahalni",
      "66-dodatkovi-pytannya-shchodo-katehoriyi-t-budova-i-terminy",
      "67-dodatkovi-pytannya-shchodo-katehoriyi-t-yurydychna-vidpovilnist",
      "68-dodatkovi-pytannya-shchodo-katehoriyi-t-bezpeka"
    ]
  }
};
