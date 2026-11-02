// Hand-written descriptions of the owner's range (#100), keyed by `publicId`. Unlike
// `catalog-data.ts` this file isn't generated: edit it by hand. Each text keeps to the perfume's
// families and notes (no years, perfumers or awards), in 2-4 sentences of 150-600 characters,
// which `catalog-descriptions.test.ts` checks. `pnpm db:import-catalog` copies a text only into
// a description that is empty, so what staff wrote in Strapi always wins.

/** One perfume's description in Ukrainian and English: plain text. */
export interface CatalogDescription {
  uk: string;
  en: string;
}

/** Every perfume of `CATALOG_PRODUCTS`, in the order of the owner's list. */
export const CATALOG_DESCRIPTIONS: Readonly<Record<string, CatalogDescription>> = {
  // La Vie Est Belle (Lancôme)
  "adffdd0e-db3b-8c86-b89e-653f1892fe6f": {
    uk: "Солодкий фруктово-квітковий аромат, що відкривається соковитою чорною смородиною та грушею. У серці — пудровий ірис і жасмин, а шлейф із пачулі, ванілі та бобів тонка робить його теплим і затишним. Добре звучить увечері та в прохолодну пору року.",
    en: "A sweet fruity floral that opens with juicy blackcurrant and pear. Powdery iris and jasmine sit at its heart, while patchouli, vanilla and tonka bean leave a warm, cosy trail. It suits evenings and cooler days.",
  },
  // Lolita Lempicka (Lolita Lempicka)
  "4fdc96c1-fd30-8fbd-bde2-0646bdb9a8b0": {
    uk: "Грайливий східно-квітковий аромат із незвичним поєднанням анісу, плюща та стиглої вишні. Фіалка й ірис додають пудровості, а лакричник, праліне і ваніль — ласої солодкості з легкою зеленню ветиверу в шлейфі. Підійде для прогулянок восени та затишних вечорів.",
    en: "A playful oriental floral built on an unusual mix of anise, ivy and ripe cherry. Violet and iris add a powdery touch, while liquorice, praline and vanilla bring a gourmand sweetness, grounded by a hint of vetiver. Lovely for autumn walks and relaxed evenings.",
  },
  // Davidoff Cool Water Woman (Davidoff)
  "87d2a746-1b93-87f2-9d35-9df20d6646c0": {
    uk: "Свіжий водяний аромат із фруктовим настроєм: ананас, айва, диня та лимон звучать прохолодно й легко. Лотос, лілія і майська троянда додають ніжної квітковості, а сандал, мускус і ваніль м’яко тримають шлейф. Чудовий вибір для спекотного літа та активного дня.",
    en: "A fresh aquatic scent with a fruity mood: pineapple, quince, melon and lemon feel cool and light. Lotus, lily and May rose add a gentle floral side, while sandalwood, musk and vanilla softly carry the trail. A great pick for hot summer days and active plans.",
  },
  // D&G Pour Femme (Dolce & Gabbana)
  "505adbab-c55b-8fd5-b11e-02026e20fd2a": {
    uk: "Ніжний східно-квітковий аромат, де мандарин, бергамот і малина змінюються апельсиновим цвітом та жасмином. Маршмелоу, геліотроп і ваніль роблять його м’яким і солодкуватим, а сандал додає тепла. Пасує до побачень і вечірніх виходів.",
    en: "A tender oriental floral where mandarin, bergamot and raspberry give way to orange blossom and jasmine. Marshmallow, heliotrope and vanilla make it soft and slightly sweet, with sandalwood adding warmth. Made for dates and evenings out.",
  },
  // D&G Light Blue (Dolce & Gabbana)
  "761676cd-a4fd-8552-9611-2143e7fffc25": {
    uk: "Світлий фруктово-квітковий аромат із хрусткими нотами лимона та зеленого яблука. Бамбук, жасмин і біла троянда звучать прозоро, а кедр з мускусом і амброю дають чистий, легкий шлейф. Ідеальний для літа, відпустки та щоденного носіння.",
    en: "A bright fruity floral with crisp notes of lemon and green apple. Bamboo, jasmine and white rose feel airy and sheer, while cedar, musk and amber leave a clean, light trail. Ideal for summer, holidays and everyday wear.",
  },
  // Dior Miss Dior Cherie (Dior)
  "eccce470-8402-804c-be83-d08dedebf8d0": {
    uk: "Фруктовий шипр із грайливим поєднанням мандарину та полуниці. Жасмин і троянда додають жіночності, а карамель на тлі пачулі та амбри робить звучання ласим і водночас елегантним. Добре підходить для весни та особливих днів.",
    en: "A fruity chypre with a playful pairing of mandarin and strawberry. Jasmine and rose add a feminine touch, while caramel over patchouli and amber makes it both delicious and elegant. A good match for spring and special days.",
  },
  // Dolce & Gabbana Anthology L'Imperatrice 3 (Dolce & Gabbana)
  "d5516865-27a9-8ac1-907a-0969dd9445bc": {
    uk: "Соковитий водяно-квітковий аромат, у якому ківі, ревінь і кавун звучать освіжально й трохи кисло. Рожевий перець додає іскри, цикламен і жасмин — ніжності, а мускус та сандал залишають чистий шлейф. Створений для теплих днів і літніх поїздок.",
    en: "A juicy aquatic floral where kiwi, rhubarb and watermelon feel refreshing and a little tart. Pink pepper adds sparkle, cyclamen and jasmine bring softness, and musk with sandalwood leaves a clean trail. Made for warm days and summer trips.",
  },
  // Donna Sergio Tacchini (Sergio Tacchini)
  "b299c4bc-469f-86f9-9c8b-8bf60fb68f13": {
    uk: "Легкий фруктово-квітковий аромат, що починається з ананаса та бергамоту. Водяна лілія, лотос і конвалія роблять його свіжим, лаванда додає трав’янистої чистоти, а сандал, ваніль і мускус м’яко завершують композицію. Зручний варіант на кожен день.",
    en: "A light fruity floral that starts with pineapple and bergamot. Water lily, lotus and lily of the valley keep it fresh, lavender adds a herbal cleanness, and sandalwood, vanilla and musk round it off softly. An easy everyday choice.",
  },
  // Davidoff Echo (Davidoff)
  "6b95f73c-79e4-8e66-aae3-ce452a2ce364": {
    uk: "Прохолодний квітковий аромат із незвичною прозорою ноткою горілки на старті. Ірис, османтус, півонія та фіалка звучать пудрово й ніжно, а білий мускус з амброю і деревом дають м’який шлейф. Підходить для офісу та спокійних вечорів.",
    en: "A cool floral scent that opens with an unusual, clear vodka accord. Iris, osmanthus, peony and violet feel powdery and gentle, while white musk, amber and woods leave a soft trail. Suits the office and quiet evenings.",
  },
  // Donna Karan Be Delicious (DKNY)
  "c82e4c9e-f5bf-8ceb-b8b7-41a2ba87bd06": {
    uk: "Хрусткий і бадьорий аромат, де огірок та грейпфрут зустрічаються із соковитим яблуком. Магнолія, конвалія, тубероза і троянда додають квіткового букета, а біла амбра та сандал тримають легкий деревний шлейф. Для весни, літа та міських днів.",
    en: "A crisp, upbeat scent where cucumber and grapefruit meet juicy apple. Magnolia, lily of the valley, tuberose and rose add a floral bouquet, while white amber and sandalwood keep a light woody trail. For spring, summer and busy city days.",
  },
  // Versace Eros (Versace)
  "f42b7182-d76a-8b1b-94b6-8a59c4b641d8": {
    uk: "Яскравий деревно-мускусний аромат, що відкривається лимоном, гранатом і калабрійським бергамотом. Квітка лимона, жасмин і півонія звучать сонячно, а мускус, амбра й сандал роблять шлейф чуттєвим і теплим. Гарний вибір для вечірніх подій.",
    en: "A vivid woody musk that opens with lemon, pomegranate and Calabrian bergamot. Lemon blossom, jasmine and peony feel sunny, while musk, amber and sandalwood make the trail warm and sensual. A fine choice for evening events.",
  },
  // Escada Miami Blossom (Escada)
  "95f80346-f714-8518-b4c6-d0a5e9d1c5cf": {
    uk: "Тропічний фруктово-квітковий аромат із соковитим кавуном, ананасом та апельсином. Тіаре, тубероза й жасмин створюють відчуття теплого пляжного вечора, а амбра, мускус і сандал залишають м’який слід. Найкраще розкривається влітку.",
    en: "A tropical fruity floral with juicy watermelon, pineapple and orange. Tiare, tuberose and jasmine evoke a warm beach evening, while amber, musk and sandalwood leave a soft trace. It shines brightest in summer.",
  },
  // Escada Collection (Escada)
  "9a8b57f9-b077-8176-b304-308b193cc70d": {
    uk: "Теплий східно-пряний аромат із темною сливою та тягучою карамеллю. Білий кедр і сандал надають композиції деревної глибини, а мускус робить шлейф м’яким і обволікальним. Пасує до холодної пори та вечірніх виходів.",
    en: "A warm spicy oriental with dark plum and rich caramel. White cedar and sandalwood give it woody depth, and musk makes the trail soft and enveloping. Suited to the cold season and nights out.",
  },
  // Escada Magnetism (Escada)
  "338a2e7d-b953-80ff-963e-5a871d32398d": {
    uk: "Насичений гурманський аромат, що стартує ягідно-фруктовим коктейлем з ананаса, чорної смородини, дині та лічі. Магнолія, ірис, жасмин і троянда з дрібкою базиліку та тмину ведуть до солодкого шлейфу з карамелі, ванілі, пачулі й бензоїну. Яскравий варіант для вечорів і холодних днів.",
    en: "A rich gourmand that starts with a berry and fruit cocktail of pineapple, blackcurrant, melon and lychee. Magnolia, iris, jasmine and rose, with a pinch of basil and cumin, lead to a sweet trail of caramel, vanilla, patchouli and benzoin. A bold option for evenings and cold days.",
  },
  // Escada Into The Blue (Escada)
  "d328f9e5-c4bf-84bf-b52b-98af9e6b0177": {
    uk: "Свіжий водяно-квітковий аромат із зеленою травою, карамболою та бергамотом на старті. Півонія і персик звучать м’яко й ніжно, а кедр, мускус та амбра залишають чистий легкий шлейф. Добре освіжає в спеку та підходить на щодень.",
    en: "A fresh aquatic floral with green grass, star fruit and bergamot up top. Peony and peach feel soft and gentle, while cedar, musk and amber leave a clean, light trail. Refreshing in the heat and easy to wear every day.",
  },
  // Moon Sparkle (Escada)
  "c2e424d7-f1c1-8979-ae79-559aa243609f": {
    uk: "Ігристий ягідний аромат із полуницею, малиною, чорною смородиною та червоним яблуком. Запашний горошок, фрезія, жасмин і троянда додають квіткової легкості, а амбра, мускус та сандал — теплого шлейфу. Для веселих вечірок і літніх днів.",
    en: "A sparkling berry scent with strawberry, raspberry, blackcurrant and red apple. Sweet pea, freesia, jasmine and rose add a light floral touch, while amber, musk and sandalwood bring a warm trail. For fun parties and summer days.",
  },
  // Gritti Tutu (Gritti)
  "f3a57f4c-2936-823f-9c10-9d5391e0efc3": {
    uk: "Ніжний і солодкий аромат, у якому вершковий кокос поєднується з грейпфрутом, чорною смородиною та яблуком. Жасмин, геліотроп, троянда і малина звучать пудрово-ягідно, а ваніль, мускус і кашмеран огортають м’якою ковдрою. Затишний вибір для прохолодних днів.",
    en: "A soft, sweet scent where creamy coconut meets grapefruit, blackcurrant and apple. Jasmine, heliotrope, rose and raspberry feel powdery and berry-like, while vanilla, musk and cashmeran wrap it like a soft blanket. A cosy choice for cooler days.",
  },
  // Play For Her (Givenchy)
  "fdacb16e-ec45-805e-b2fd-19953e5cc753": {
    uk: "Тепла східно-квіткова композиція з рожевим перцем і бархатистим персиком на початку. Апельсиновий цвіт та орхідея звучать чуттєво, а аміріс, сандал, пачулі, бензоїн і боби тонка дають глибокий солодкуватий шлейф. Підходить для вечора та побачень.",
    en: "A warm oriental floral with pink pepper and velvety peach at the start. Orange blossom and orchid feel sensual, while amyris, sandalwood, patchouli, benzoin and tonka bean leave a deep, slightly sweet trail. Best for evenings and dates.",
  },
  // Givenchy Absolutely Irresistible (Givenchy)
  "272b0008-bd13-898f-967b-7ca8b0cf46cb": {
    uk: "Квітковий аромат із несподіваною пікантністю: мандарин і червоні ягоди приправлені паприкою. Жасмин, апельсиновий цвіт та геліотроп роблять його жіночним і пудровим, а кедр, пачулі й амбра додають стійкого тепла. Для вечірніх виходів і свят.",
    en: "A floral scent with an unexpected kick: mandarin and red berries spiced with paprika. Jasmine, orange blossom and heliotrope make it feminine and powdery, while cedar, patchouli and amber add lasting warmth. For evenings out and celebrations.",
  },
  // Ange Ou Demon Elixir (Givenchy)
  "7d531029-1360-8a22-9234-fe003dfaed3c": {
    uk: "Глибокий східно-квітковий аромат, де мандарин зустрічається з теплим шафраном. Білі квіти, жасмин самбак і орхідея звучать розкішно, а пачулі, ваніль, мускус і шкіра роблять шлейф загадковим. Найкраще пасує до вечора та холодної погоди.",
    en: "A deep oriental floral where mandarin meets warm saffron. White flowers, sambac jasmine and orchid feel luxurious, while patchouli, vanilla, musk and leather give the trail an air of mystery. Best for evenings and cold weather.",
  },
  // Gucci Flora (Gucci)
  "ac8d5217-6a51-89dd-8c69-cd24bf66ed5e": {
    uk: "Свіжий квітковий аромат, у якому цитруси й мандарин підкреслюють ніжність півонії. Османтус, троянда і рожевий перець додають легкої пікантності, а сандал, пачулі та мадагаскарська ваніль дають м’яке тепло. Гарний компаньйон для весни та денних зустрічей.",
    en: "A fresh floral where citrus and mandarin lift a delicate peony. Osmanthus, rose and pink pepper add a gentle spice, while sandalwood, patchouli and Madagascar vanilla bring soft warmth. A lovely companion for spring and daytime plans.",
  },
  // Hot Couture (Givenchy)
  "90b13bda-eb4c-8e38-9390-2127afd4e5c8": {
    uk: "Яскравий східно-квітковий аромат із соковитою малиною, бергамотом і апельсином. Магнолія додає кремової квітковості, а ветивер, мускус, амбра та сандал створюють сміливий теплий шлейф. Для вечірніх подій і моментів, коли хочеться бути помітною.",
    en: "A vivid oriental floral with juicy raspberry, bergamot and orange. Magnolia adds a creamy floral note, while vetiver, musk, amber and sandalwood build a bold, warm trail. For evening events and moments when you want to stand out.",
  },
  // Hugo Boss Woman (Hugo Boss)
  "3805a370-ce93-84ff-beab-cd677bfbddf0": {
    uk: "Спокійний фруктово-квітковий аромат із соковитою динею, яблуком і персиком. Дубовий мох надає легкої зеленої терпкості, а сандал і кедр роблять шлейф м’яким і деревним. Зручний на кожен день і для роботи.",
    en: "A calm fruity floral with juicy melon, apple and peach. Oakmoss adds a light green dryness, while sandalwood and cedar keep the trail soft and woody. Easy for everyday and work.",
  },
  // Hypnotic Poison (Dior)
  "56aa2769-36ba-890a-a4d4-89cc8723df63": {
    uk: "Чарівний ванільний аромат із соковитими абрикосом і сливою та вершковим кокосом на старті. Тубероза, жасмин, троянда й дрібка тмину звучать п’янко, а мигдаль, ваніль, сандал і мускус створюють глибокий солодкий шлейф. Створений для вечорів і холодної пори.",
    en: "A captivating vanilla scent with juicy apricot, plum and creamy coconut at the start. Tuberose, jasmine, rose and a pinch of cumin feel heady, while almond, vanilla, sandalwood and musk create a deep, sweet trail. Made for evenings and the cold season.",
  },
  // Boss Alive (Hugo Boss)
  "db09263a-e42c-8654-b973-27c5d50d73d8": {
    uk: "Теплий деревний аромат із фруктовим початком з яблука, чорної смородини та сливи. Кориця додає пряності, мадагаскарська ваніль — солодкості, а білий кедр, оливкове дерево й сандал роблять шлейф затишним. Пасує до осені та зимових днів.",
    en: "A warm woody scent with a fruity opening of apple, blackcurrant and plum. Cinnamon adds spice, Madagascar vanilla brings sweetness, and white cedar, olive wood and sandalwood make the trail cosy. Fits autumn and winter days.",
  },
  // Hugo Boss Nuit (Hugo Boss)
  "9e8365d8-f018-8e4a-9865-6bc01e3ce6fa": {
    uk: "Елегантний квітковий аромат, де персик і альдегіди створюють мерехтливий старт. Жасмин, фіалка та білі квіти звучать витончено, а мох і сандал роблять шлейф стриманим і пудровим. Чудово підходить для вечірніх виходів.",
    en: "An elegant floral where peach and aldehydes give a shimmering start. Jasmine, violet and white flowers feel refined, while moss and sandalwood keep the trail understated and powdery. Lovely for evenings out.",
  },
  // Hugo Boss Orange (Hugo Boss)
  "200c18c7-a15b-8a77-b514-995b3027ea70": {
    uk: "Сонячний квітковий аромат, що починається з хрусткого яблука. Апельсиновий цвіт і білі квіти звучать світло й радісно, а сандал, оливкове дерево та ваніль додають м’якого тепла. Гарний вибір на щодень і для весняних прогулянок.",
    en: "A sunny floral that begins with crisp apple. Orange blossom and white flowers feel bright and cheerful, while sandalwood, olive wood and vanilla add gentle warmth. A nice everyday pick and great for spring walks.",
  },
  // Jimmy Choo Blossom (Jimmy Choo)
  "4ce5a513-2b90-889c-8b47-bd30def6f0a8": {
    uk: "Романтичний фруктово-квітковий аромат із цитрусами, червоними ягодами та малиною. Запашний горошок і троянда роблять його ніжним, а сандал і білий мускус залишають чистий м’який шлейф. Для весни, побачень і світлих днів.",
    en: "A romantic fruity floral with citrus, red berries and raspberry. Sweet pea and rose make it tender, while sandalwood and white musk leave a clean, soft trail. For spring, dates and bright days.",
  },
  // Blackberry & Bay (Jo Malone London)
  "87fd9ab1-e114-875b-b018-d8faeb50ea2a": {
    uk: "Свіжий зелено-фруктовий аромат, у якому соковита ожина поєднується з терпким лавровим листом. Квіткові ноти пом’якшують композицію, а кедр і ветивер додають деревної свіжості. Добре звучить наприкінці літа та на початку осені.",
    en: "A fresh green fruity scent where juicy blackberry meets crisp bay leaf. Floral notes soften the blend, while cedar and vetiver add a woody freshness. It sounds best in late summer and early autumn.",
  },
  // Jennifer Lopez Still (Jennifer Lopez)
  "fec8781f-e866-8a59-9691-1a717bceb372": {
    uk: "М’який квітковий аромат із легкою пікантністю перцю та мандарину на старті. Рис, чай, жимолость, фрезія, конвалія, троянда й ірис звучать чисто й ніжно, а сандал, амбра, мускус і бензоїн дають теплий шлейф. Підходить для щоденного носіння та офісу.",
    en: "A soft floral with a light kick of pepper and mandarin at the start. Rice, tea, honeysuckle, freesia, lily of the valley, rose and iris feel clean and gentle, while sandalwood, amber, musk and benzoin give a warm trail. Good for everyday and the office.",
  },
  // JPG Gaultier 2 (Jean Paul Gaultier)
  "b14d4d77-71c1-866d-948a-55346d4a173b": {
    uk: "Мінімалістичний гурманський аромат, побудований на трьох нотах: амбрі, ванілі та мускусі. Він звучить тепло, м’яко й дуже близько до шкіри, тому однаково пасує і жінкам, і чоловікам. Затишний вибір для холодних днів і вечорів.",
    en: "A minimalist gourmand built on just three notes: amber, vanilla and musk. It feels warm, soft and close to the skin, so it suits anyone, whatever their gender. A cosy choice for cold days and evenings.",
  },
  // Jil Sander (Jil Sander)
  "fbe3c840-9a9a-89bd-b8ce-360fa8baff36": {
    uk: "Класичний за звучанням альдегідно-квітковий аромат, де мерехтливі альдегіди поєднуються зі сливою, абрикосом і бергамотом. Тубероза, іланг-іланг, жасмин і фіалка звучать розкішно, а сандал, боби тонка, ваніль та кедр дають теплий пудровий шлейф. Для особливих подій і вечорів.",
    en: "An aldehydic floral in the classic style, where sparkling aldehydes meet plum, apricot and bergamot. Tuberose, ylang-ylang, jasmine and violet feel opulent, while sandalwood, tonka bean, vanilla and cedar give a warm, powdery trail. For special occasions and evenings.",
  },
  // Marry Me (Lanvin)
  "1c9299bf-9dcd-840a-92f0-8de81b832549": {
    uk: "Ніжний фруктово-квітковий аромат із гірким апельсином і персиком на старті. Фрезія, жасмин, магнолія та троянда створюють романтичний букет, а мускус, амбра і кедр — м’який шлейф. Чудово підходить для весни та урочистих днів.",
    en: "A delicate fruity floral with bitter orange and peach up front. Freesia, jasmine, magnolia and rose form a romantic bouquet, while musk, amber and cedar leave a soft trail. Lovely for spring and festive days.",
  },
  // Lift (Lolita Lempicka)
  "85619d6d-b701-8d52-a464-39e1411635af": {
    uk: "Лаконічний квітковий аромат, у якому стигла вишня поєднується з теплими спеціями. Альдегідні ноти надають звучанню чистоти та легкого мерехтіння. Цікавий вибір на щодень, коли хочеться чогось незвичного.",
    en: "A concise floral scent where ripe cherry meets warm spices. Aldehydic notes give it a clean, slightly shimmering feel. An interesting everyday choice when you want something a little unusual.",
  },
  // Lancome Hypnose (Lancôme)
  "f260c06f-9f38-8ca2-8838-b773b5806e8a": {
    uk: "Чуттєвий східний аромат, що відкривається екзотичною пасифлорою. Жасмин і гарденія звучать насичено й квітково, а ваніль з ветивером дають теплий, злегка димний шлейф. Пасує до вечорів і холодної пори року.",
    en: "A sensual oriental that opens with exotic passion flower. Jasmine and gardenia feel rich and floral, while vanilla and vetiver leave a warm, slightly smoky trail. Suited to evenings and the colder months.",
  },
  // Lacoste (Lacoste)
  "56f07946-8c2e-8d86-98ba-c331105e05f7": {
    uk: "Легкий і чистий квітковий аромат із зеленим чаєм та білими квітами. Амбра додає м’якого тепла, не обтяжуючи композицію. Зручний для офісу, навчання та щоденних справ.",
    en: "A light, clean floral with green tea and white flowers. Amber adds a soft warmth without weighing it down. Easy to wear to the office, to class and for everyday errands.",
  },
  // Eclat D'Arpege (Lanvin)
  "9cfaac7f-702a-8a40-806a-9fdab75b4297": {
    uk: "Прозорий зелено-квітковий аромат із листям чаю та зеленим бузком. Півонія і квітка персика звучать ніжно й акварельно, а амбра м’яко зігріває шлейф. Підходить для весни та спокійних днів.",
    en: "A sheer green floral with tea leaves and green lilac. Peony and peach blossom feel soft and watercolour-like, while amber gently warms the trail. Perfect for spring and calm days.",
  },
  // Moschino Funny (Moschino)
  "0a051cc5-ac66-85cf-8a11-7726fa1ab845": {
    uk: "Веселий фруктово-квітковий аромат із апельсином, червоною смородиною та зеленим чаєм. Дрібка перцю додає жвавості, жасмин і півонія — ніжності, а амбра, мускус і кедр роблять шлейф легким і теплим. Для молодіжного настрою на кожен день.",
    en: "A cheerful fruity floral with orange, redcurrant and green tea. A pinch of pepper adds liveliness, jasmine and peony bring softness, and amber, musk and cedar keep the trail light and warm. For a youthful, everyday mood.",
  },
  // Magie Noire (Lancôme)
  "75520cbe-0314-8e11-b569-f9617af72194": {
    uk: "Таємничий східний шипр із глибокою трояндою та іланг-ілангом. Спеції роблять його теплим і загадковим, а сандал, пачулі й амбра створюють насичений довгий шлейф. Найкраще звучить увечері та взимку.",
    en: "A mysterious oriental chypre with deep rose and ylang-ylang. Spices make it warm and enigmatic, while sandalwood, patchouli and amber create a rich, long trail. It sounds best in the evening and in winter.",
  },
  // Marc Jacobs Daisy (Marc Jacobs)
  "cbba8cb7-61f9-8870-826e-64a94433e2ef": {
    uk: "Світлий і безтурботний аромат, де листя фіалки, грейпфрут і земляниця звучать свіжо та соковито. Гарденія, фіалка й жасмин додають ніжності, а мускус, біле дерево та ваніль залишають м’який шлейф. Для весни, літа й гарного настрою.",
    en: "A bright, carefree scent where violet leaf, grapefruit and wild strawberry feel fresh and juicy. Gardenia, violet and jasmine add tenderness, while musk, white woods and vanilla leave a soft trail. For spring, summer and good moods.",
  },
  // Noa (Cacharel)
  "5ea3d431-f21b-893c-8a75-9003e538e1b5": {
    uk: "Ніжний квітково-деревний аромат із білою півонією та чистим білим мускусом. Легка нотка кави та коріандру додає теплоти й несподіваної глибини. Спокійний вибір для щоденного носіння та затишних днів.",
    en: "A gentle floral woody scent with white peony and clean white musk. A light touch of coffee and coriander adds warmth and unexpected depth. A calm choice for everyday wear and cosy days.",
  },
  // Ex Nihilo Fleur Narcotique (Ex Nihilo)
  "67973fcc-144d-8953-8657-8a7cafed615d": {
    uk: "Сяйливий квітковий аромат із соковитими лічі, персиком і бергамотом. Жасмин, півонія та апельсиновий цвіт звучать п’янко й світло, а мускус, мох і деревні ноти тримають елегантний шлейф. Підходить і для дня, і для вечора.",
    en: "A radiant floral with juicy lychee, peach and bergamot. Jasmine, peony and orange blossom feel heady yet airy, while musk, moss and woody notes hold an elegant trail. Works for both day and evening.",
  },
  // Narciso Rodriguez For Her (Narciso Rodriguez)
  "2cdccdfe-c920-88b8-99be-07b203b70582": {
    uk: "Чуттєвий мускусний аромат, де апельсин і квіткові ноти звучать м’яко та інтимно. Амбра й ваніль додають тепла, а ветивер і мускус роблять шлейф чистим, шкірним і стійким. Гарний вибір і для офісу, і для вечора.",
    en: "A sensual musky scent where orange and floral notes feel soft and intimate. Amber and vanilla add warmth, while vetiver and musk keep the trail clean, skin-like and lasting. A good choice for both the office and the evening.",
  },
  // Love In Paris (Nina Ricci)
  "b96b42fd-7f75-851b-912a-72490d10b76c": {
    uk: "Романтичний квітковий аромат, де бергамот відкриває букет із троянди та жасмину. Аніс і абрикос додають солодкуватої пряності, а ваніль робить шлейф м’яким і теплим. Для побачень і весняних вечорів.",
    en: "A romantic floral where bergamot opens a bouquet of rose and jasmine. Anise and apricot add a sweet spiciness, and vanilla makes the trail soft and warm. For dates and spring evenings.",
  },
  // Black Opium (Yves Saint Laurent)
  "753ca70e-4a73-8fe2-96c2-9260daefd2ba": {
    uk: "Енергійний східний аромат, у якому кава та ваніль зустрічаються з грушею і перцем. Цвіт апельсину і жасмин додають квіткового світла, роблячи композицію водночас ласою та бадьорою. Ідеальний для вечірок і холодних вечорів.",
    en: "An energetic oriental where coffee and vanilla meet pear and pepper. Orange blossom and jasmine add floral brightness, making the blend both indulgent and invigorating. Ideal for parties and chilly nights.",
  },
  // Omnia Bvlgari (Bvlgari)
  "34218a73-8a98-88fe-aacd-0b911e2c6df5": {
    uk: "Прозорий і спокійний аромат, де мандарин поєднується з ніжним шафраном. Нота чаю додає медитативної чистоти, а білий мускус залишає легкий, майже невагомий шлейф. Підходить для щоденного носіння в будь-яку пору року.",
    en: "A sheer, serene scent where mandarin pairs with soft saffron. A tea note adds a meditative cleanness, and white musk leaves a light, almost weightless trail. Easy to wear every day, all year round.",
  },
  // Xs Black (Paco Rabanne)
  "92f877bf-a5e9-820e-99ce-2f66cb3addb5": {
    uk: "Темний і спокусливий східно-квітковий аромат із трояндою та чорною фіалкою. Квіти какао додають ласої ноти, а пачулі й ваніль роблять шлейф глибоким і теплим. Для вечірніх виходів і зимових вечорів.",
    en: "A dark, alluring oriental floral with rose and black violet. Cocoa blossom adds a gourmand note, while patchouli and vanilla make the trail deep and warm. For nights out and winter evenings.",
  },
  // Paris (Yves Saint Laurent)
  "38f4e3fb-a6c9-837a-8b43-95b779c46620": {
    uk: "Пишний трояндовий аромат, який бергамот відкриває свіжим цитрусовим акцентом. Мімоза, фіалка й ірис надають троянді пудровості та елегантності. Чудово пасує до особливих подій і романтичних вечорів.",
    en: "A lush rose fragrance that bergamot opens with a fresh citrus accent. Mimosa, violet and iris give the rose a powdery, elegant feel. Lovely for special occasions and romantic evenings.",
  },
  // Fame Paco Rabanne (Paco Rabanne)
  "63cc02c1-022c-86b8-b0a0-c4e5678ab21e": {
    uk: "Сучасний деревно-квітковий аромат із соковитим манго та бергамотом на старті. Жасмин додає квіткового сяйва, а ваніль, мускус і пачулі роблять шлейф чуттєвим і стійким. Для вечорів і моментів, коли хочеться впевненості.",
    en: "A modern woody floral with juicy mango and bergamot at the start. Jasmine adds a floral glow, while vanilla, musk and patchouli keep the trail sensual and lasting. For evenings and times when you want to feel confident.",
  },
  // Lady Million (Paco Rabanne)
  "e043bf75-27f9-8dae-a38c-8864dccf1483": {
    uk: "Сміливий фруктово-квітковий аромат із апельсином і малиною на старті. Жасмин і гарденія звучать розкішно, а мед і пачулі створюють солодкий, насичений шлейф. Підійде для вечірок і святкових подій.",
    en: "A bold fruity floral with orange and raspberry up front. Jasmine and gardenia feel luxurious, while honey and patchouli create a sweet, rich trail. Great for parties and festive occasions.",
  },
  // Premier Jour (Nina Ricci)
  "78f26be6-2fa3-8c92-97af-01d51d23e1dc": {
    uk: "Свіжий цитрусовий аромат, що відкривається мандарином і бадьорими цитрусами. Квіти та гарденія роблять його ніжним, а ваніль додає легкого тепла в шлейфі. Чудовий вибір для ранку, весни та теплих днів.",
    en: "A fresh citrus scent that opens with mandarin and zesty citrus. Flowers and gardenia make it tender, and vanilla adds a light warmth to the trail. A great choice for mornings, spring and warm days.",
  },
  // Pure Poison (Dior)
  "238d3f89-2b4d-8d3a-a23e-7c6979d44f10": {
    uk: "Світлий східно-квітковий аромат, у якому жасмин і гарденія звучать чисто й сяйливо. Апельсин і мандарин додають свіжості, а амбра робить шлейф теплим і м’яким. Пасує до вечорів і особливих подій.",
    en: "A luminous oriental floral in which jasmine and gardenia feel clean and radiant. Orange and mandarin add freshness, while amber makes the trail warm and soft. Suits evenings and special occasions.",
  },
  // Roberto Cavalli (Roberto Cavalli)
  "79d20987-c138-8be1-b362-08a5fab511c8": {
    uk: "Теплий східно-квітковий аромат, де ніжна гліцинія поєднується з пікантним перцем. Жасмин додає жіночності, а ваніль, пачулі та сандал роблять шлейф глибоким і чуттєвим. Для вечорів і холодної пори року.",
    en: "A warm oriental floral where delicate wisteria meets a peppery spark. Jasmine adds femininity, while vanilla, patchouli and sandalwood make the trail deep and sensual. For evenings and the colder months.",
  },
  // Rush (Gucci)
  "16c4d836-6f51-8b90-a08a-edf451c287e6": {
    uk: "Сміливий квітковий аромат із гарденією та фрезією в центрі композиції. Ваніль додає солодкої теплоти, а пачулі й ветивер роблять шлейф насиченим і трохи димним. Найкраще пасує до вечірніх виходів.",
    en: "A daring floral with gardenia and freesia at its centre. Vanilla adds sweet warmth, while patchouli and vetiver make the trail rich and slightly smoky. Best suited to evenings out.",
  },
  // Rush 2 (Gucci)
  "9095fe37-75b1-8cd0-a404-a96b06f0d696": {
    uk: "Свіжий квітковий букет із нарцисом, фрезією та лілійником. Троянда й гарденія роблять звучання м’яким і жіночним, а мускус залишає чистий легкий шлейф. Добре підходить для весни та денних зустрічей.",
    en: "A fresh floral bouquet of narcissus, freesia and daylily. Rose and gardenia make it soft and feminine, while musk leaves a clean, light trail. A good fit for spring and daytime meetings.",
  },
  // Ralph Lauren Ralph (Ralph Lauren)
  "a9772521-20f4-8750-9d26-dcfc22fb6fb3": {
    uk: "Легкий цитрусово-квітковий аромат із хрустким яблуком і мандарином. Зелена нота вільхи додає свіжості, а магнолія і фрезія — ніжної квітковості. Зручний для теплих днів, навчання та прогулянок.",
    en: "A light citrus floral with crisp apple and mandarin. A green alder note adds freshness, while magnolia and freesia bring a gentle floral touch. Easy for warm days, study and walks.",
  },
  // Scandal Jean Paul Gaultier (Jean Paul Gaultier)
  "2fb31ddb-7085-8534-9892-d1623d673d9d": {
    uk: "Медовий квітковий шипр, у якому мандарин і апельсин змінюються жасмином та гарденією. Персик додає бархатистості, а мед робить шлейф солодким і теплим. Підійде для вечірніх подій і свят.",
    en: "A honeyed floral chypre in which mandarin and orange give way to jasmine and gardenia. Peach adds a velvety touch, and honey makes the trail sweet and warm. Ideal for evening events and celebrations.",
  },
  // Sospiro Erba Pura (Sospiro)
  "e625c058-fd99-8eba-b8dc-76b7f01ba3db": {
    uk: "Сонячний фруктовий аромат з апельсином, бергамотом і лимоном на старті. Соковиті фруктові ноти поступово переходять у теплу й стійку амбру. Однаково пасує жінкам і чоловікам, а найкраще розкривається в теплу погоду.",
    en: "A sunny fruity scent with orange, bergamot and lemon at the start. Juicy fruit notes slowly melt into warm, long-lasting amber. Equally good on anyone, it opens up best in warm weather.",
  },
  // Shiseido Zen (Shiseido)
  "193552cb-02c6-8f90-8db1-dc3f8c8663bf": {
    uk: "Спокійний квітково-деревний аромат, де цитрус і квіти звучать м’яко та гармонійно. Мускатний горіх додає теплої пряності, а сандал і кедр роблять шлейф затишним. Підходить для роботи й тихих днів.",
    en: "A calm floral woody scent in which citrus and flowers feel soft and balanced. Nutmeg adds a warm spice, while sandalwood and cedar make the trail comforting. Suits work and quiet days.",
  },
  // Sexy Graffiti Escada (Escada)
  "74d7c289-3393-8a94-9ef4-77868e7cc641": {
    uk: "Яскравий і грайливий аромат із щедрим фруктовим коктейлем на старті. Фіалка додає ніжної квітковості, а мускус і ваніль роблять шлейф м’яким і солодкуватим. Для молодіжних вечірок і літнього настрою.",
    en: "A bright, playful scent with a generous fruit cocktail at the start. Violet adds a soft floral note, while musk and vanilla make the trail smooth and slightly sweet. For youthful parties and a summery mood.",
  },
  // Tease Dreamer V&S (Victoria's Secret)
  "7a383909-1431-853a-9dbb-b4adc64fdf85": {
    uk: "Пляжний аромат, у якому вершковий кокос поєднується з морською сіллю. Сонячні ноти створюють відчуття теплої шкіри після дня біля моря. Ідеальний для літа, відпустки та неквапливих вихідних.",
    en: "A beachy scent where creamy coconut meets a breath of sea salt. Sunny notes evoke warm, sun-kissed skin after a long day by the sea. Perfect for summer, holidays and lazy weekends.",
  },
  // Kirke Tiziana Terenzi (Tiziana Terenzi)
  "23b91ff9-bbd9-803b-8b17-a92ecb4fc7a2": {
    uk: "Соковитий фруктовий шипр із персиком, маракуйєю та грушею. Гірська смородина додає ягідної терпкості, а півонія — ніжного квіткового штриха. Яскравий вибір для літа та вечірніх прогулянок.",
    en: "A juicy fruity chypre with peach, passion fruit and pear. Mountain currant adds a tart berry edge, while peony brings a soft floral touch. A vibrant choice for summer and evening strolls.",
  },
  // Viktor Rolf Flowerbomb (Viktor&Rolf)
  "981dd4f2-f595-8048-8d88-906cc61abefe": {
    uk: "Пишний квітковий аромат, що вибухає букетом із жасмину, орхідеї та троянди. Бергамот і чай додають свіжості на старті, а османтус — легкого фруктового відтінку. Для свят, побачень і вечорів.",
    en: "A lush floral that bursts with a bouquet of jasmine, orchid and rose. Bergamot and tea add freshness at the start, while osmanthus brings a light fruity nuance. For celebrations, dates and evenings.",
  },
  // Versace Miss Pink (Versace)
  "c9872320-524b-8eee-856c-8605faf46b44": {
    uk: "Солодкий фруктово-квітковий аромат із малиною та сливою. Півонія, лотос і магнолія звучать ніжно й рожево, а амбра додає м’якого тепла в шлейфі. Підійде для весни та романтичних зустрічей.",
    en: "A sweet fruity floral with raspberry and plum. Peony, lotus and magnolia feel soft and rosy, while amber adds gentle warmth to the trail. Suits spring and romantic meetings.",
  },
  // Victoria's Secret Bombshell (Victoria's Secret)
  "bd52e728-ddb9-8925-ae73-b8a779939def": {
    uk: "Життєрадісний фруктовий аромат із мандарином, ананасом, маракуйєю та полуницею. Жасмин додає квіткової ніжності, не перебиваючи соковитого настрою. Ідеальний для літа, відпочинку й щоденних справ.",
    en: "A cheerful fruity scent with mandarin, pineapple, passion fruit and strawberry. Jasmine adds a floral softness without overpowering the juicy mood. Ideal for summer, leisure and everyday errands.",
  },
  // Very Irresistible (Givenchy)
  "7075fa6b-8eb9-8c82-ad84-50b7e72e3560": {
    uk: "Свіжий трояндовий аромат, який підкреслює зерно анісу з його легкою пряністю. Мускус робить звучання чистим і м’яким, а троянда залишається в центрі уваги. Елегантний вибір для дня і вечора.",
    en: "A fresh rose scent lifted by the light spice of anise seed. Musk keeps it clean and soft, while the rose stays centre stage. An elegant choice for day and night.",
  },
  // Versace Bright Crystal (Versace)
  "fcb03800-34cb-84c5-9a60-ceb4ffbbec9f": {
    uk: "Прозорий квітковий аромат із бадьорим юдзу та насінням гранату. Півонія, лотос і листочки магнолії звучать свіжо й ніжно, наче весняний ранок. Чудовий вибір для теплої пори та щоденного носіння.",
    en: "A sheer floral with zesty yuzu and pomegranate seeds. Peony, lotus and magnolia leaves feel fresh and delicate, like a spring morning. A great pick for warm weather and everyday wear.",
  },
  // Versense Versace (Versace)
  "1c8835f6-ddae-8d4e-9e47-c02ac8b94a71": {
    uk: "Середземноморський деревний аромат, що відкривається бергамотом, мандарином і цитрусом. Інжир і груша додають соковитої зеленуватої солодкості, лілія — квіткового світла, а кедр тримає шлейф. Для літніх днів і поїздок до моря.",
    en: "A Mediterranean woody scent that opens with bergamot, mandarin and citrus. Fig and pear add a juicy, green sweetness, lily brings floral light, and cedar anchors the trail. For summer days and trips to the sea.",
  },
  // Victoria's Secret Paradise (Victoria's Secret)
  "4168cbc7-0093-8480-abc6-d749fdecd225": {
    uk: "Свіжий фруктово-квітковий аромат із бадьорим грейпфрутом і чорною смородиною. Конвалія робить його ніжним і чистим, а деревні ноти додають легкої основи. Зручний на щодень і в спекотну погоду.",
    en: "A fresh fruity floral with zesty grapefruit and blackcurrant. Lily of the valley makes it tender and clean, while woody notes give a light base. Easy for everyday and hot weather.",
  },
  // Bombshell Isle V&S (Victoria's Secret)
  "6e289de2-6240-8524-89bb-1bbe59cc2b20": {
    uk: "Свіжий острівний аромат, у якому повітря океану поєднується з ніжним кокосом. Перлова півонія додає м’якої квітковості й легкого сяйва. Ідеальний для літа, пляжу та відпусток.",
    en: "A fresh island scent where ocean air meets soft coconut. Pearly peony adds a gentle floral glow and a touch of shimmer. Perfect for summer, the beach and holidays.",
  },
  // Armand Basi In Red (Armand Basi)
  "f7193041-e75b-8dfd-a24f-62936adc8c5c": {
    uk: "Пікантний фруктово-квітковий аромат, де бергамот і мандарин зігріті імбиром та кардамоном. Конвалія додає чистої квіткової ніжності. Гарний вибір для осінніх днів і вечірніх зустрічей.",
    en: "A spicy fruity floral where bergamot and mandarin are warmed by ginger and cardamom. Lily of the valley adds a clean floral softness. A good choice for autumn days and evening plans.",
  },
  // D&G L'Imperatrice 3 (Dolce & Gabbana)
  "ffdadd65-d4e9-80d5-b351-5807fb241296": {
    uk: "Літній деревно-квітковий аромат, у якому прохолодний кавун і ківі звучать соковито та освіжально. Жасмин і цикламен додають квіткової м’якості, а мускус із сандалом роблять шлейф теплим. Для спеки, відпусток і легкого настрою.",
    en: "A summery woody floral in which cool watermelon and kiwi feel juicy and refreshing. Jasmine and cyclamen add floral softness, while musk and sandalwood warm up the trail. For heatwaves, holidays and a carefree mood.",
  },
  // Montale Roses Musk (Montale)
  "7fb46cd1-4d40-8d0e-9407-b34a0679aef0": {
    uk: "Ніжний трояндово-мускусний аромат, у центрі якого непальська троянда. Жасмин підсилює квіткове звучання, а мускус огортає його м’якою чистою вуаллю. Чудовий вибір для романтичних вечорів.",
    en: "A tender rose and musk scent centred on Nepalese rose. Jasmine deepens the floral side, while musk wraps it in a soft, clean veil. A lovely choice for romantic evenings.",
  },
  // Montale Vanille Absolu (Montale)
  "6dda773e-42cd-8510-b9e1-7c88d6010d53": {
    uk: "Насичений ванільний аромат, у якому солодка ваніль приправлена гвоздикою та корицею. Він звучить тепло, пряно й дуже затишно. Ідеальний для зимових вечорів і холодної погоди.",
    en: "A rich vanilla scent where sweet vanilla is spiced with clove and cinnamon. It feels warm, spicy and very cosy. Ideal for winter evenings and cold weather.",
  },
  // Vanilla Blend (Zarkoperfume)
  "63ce05eb-4858-86a5-925e-b07a2c1913a7": {
    uk: "М’який ванільний аромат із пудровими солодкими нотами та деревно-мускусною основою. Звучить затишно й ненав’язливо, тому пасує будь-кому незалежно від статі. Гарний вибір на щодень і для прохолодних днів.",
    en: "A soft vanilla scent with powdery sweet notes over a woody musk base. It feels cosy and understated, so it suits anyone regardless of gender. A good everyday pick, especially on cooler days.",
  },
  // A*Men (Mugler)
  "83695080-2c78-885b-870d-d141b7616be3": {
    uk: "Насичений східно-пряний аромат, де м’ята та лаванда передують теплій кориці. Пачулі, мускус і кедр роблять шлейф глибоким і стійким. Для холодної пори та вечорів.",
    en: "A rich spicy oriental where mint and lavender lead into warm cinnamon. Patchouli, musk and cedar make the trail deep and long-lasting. For the cold season and evenings.",
  },
  // Acqua Di Gio (Giorgio Armani)
  "e162a3db-2e16-831d-9b41-4a3c3a798e43": {
    uk: "Чистий свіжий аромат моря, де бергамот, лимон, апельсин і лайм звучать бадьоро й прозоро. Морські ноти додають відчуття бризу, а мускус робить шлейф чистим. Ідеальний для літа, спорту та щоденного носіння.",
    en: "A clean, fresh marine scent where bergamot, lemon, orange and lime feel zesty and transparent. Sea notes bring a breezy feel, while musk keeps the trail clean. Ideal for summer, sport and everyday wear.",
  },
  // Allure Home (Chanel)
  "ffbaf9ae-36d2-8b98-86ff-43b57bf70380": {
    uk: "Елегантний деревний аромат, що відкривається мандарином, апельсином і альдегідами. Білий кедр надає чистої деревності, а ваніль та амбра роблять шлейф теплим і м’яким. Пасує до ділових зустрічей і вечорів.",
    en: "An elegant woody scent that opens with mandarin, orange and aldehydes. White cedar adds clean woodiness, while vanilla and amber make the trail warm and smooth. Suits business meetings and evenings.",
  },
  // Hayati Attar Collection (Attar Collection)
  "e82c581f-eeb8-8d62-b074-b48e341f2f77": {
    uk: "Солодкий східний аромат із соковитим ананасом, малиною та чорною смородиною. Мед і мускус роблять його теплим, обволікальним і стійким. Для вечорів і холодної пори року.",
    en: "A sweet oriental scent with juicy pineapple, raspberry and blackcurrant. Honey and musk make it warm, enveloping and long-lasting. For evenings and the colder months.",
  },
  // Antonio Banderas Blue (Antonio Banderas)
  "41dfadb7-cd8c-80e0-a16b-37a610664743": {
    uk: "Незвичний пряний аромат, де свіжі бергамот, диня та зелене яблуко зустрічаються з ноткою капучіно. М’ята й перець додають бадьорості та пікантності. Підходить для щоденного носіння і вечірніх прогулянок.",
    en: "An unusual spicy scent where fresh bergamot, melon and green apple meet a note of cappuccino. Mint and pepper add energy and bite. Fits everyday wear and evening walks.",
  },
  // Azzaro Rex (Azzaro)
  "f0482f3c-d633-823c-a2f0-f84e80922641": {
    uk: "Деревно-цитрусовий аромат із бадьорим лимоном та імбиром на старті. Нота віскі додає тепла й характеру, а мох і мускус роблять шлейф м’яким. Для вечорів, зустрічей із друзями та прохолодної погоди.",
    en: "A woody citrus scent with zesty lemon and ginger up top. A whisky note adds warmth and character, while moss and musk soften the trail. For evenings, time with friends and cool weather.",
  },
  // Armani Code (Giorgio Armani)
  "989a2355-4bfb-8716-a19f-44e5b2f95ea7": {
    uk: "Вечірній східно-пряний аромат, у якому бергамот і лимон змінюються анісом та квітами оливкового дерева. Тютюн робить шлейф теплим, глибоким і чуттєвим. Ідеальний для побачень і вечірніх виходів.",
    en: "An evening spicy oriental where bergamot and lemon give way to anise and olive blossom. Tobacco makes the trail warm, deep and sensual. Ideal for dates and nights out.",
  },
  // Armani Zeus (Giorgio Armani)
  "27f1fdfa-02cb-877e-aed2-131b480db33a": {
    uk: "Свіжий фужерний аромат із лавандою, тархуном і м’ятою, які звучать трав’янисто й бадьоро. Мандарин і бергамот додають цитрусового світла. Зручний для роботи, спорту й теплих днів.",
    en: "A fresh fougère with lavender, tarragon and mint that feel herbal and invigorating. Mandarin and bergamot add citrus brightness. Easy for work, sport and warm days.",
  },
  // Baccarat Rouge 540 (Maison Francis Kurkdjian)
  "a69ed314-ade2-8af4-838d-5806c0741750": {
    uk: "Сяйливий східно-деревний аромат, де гіркий мигдаль і шафран звучать тепло та повітряно. Білий кедр, сіра амбра, смолиста ялина й мускус створюють довгий кристалічний шлейф. Пасує будь-кому, а найкраще розкривається ввечері.",
    en: "A radiant oriental woody scent where bitter almond and saffron feel warm and airy. White cedar, grey amber, fir and musk create a long, crystalline trail. It suits anyone and is at its best in the evening.",
  },
  // Boss (Hugo Boss)
  "338452cf-8d5a-81b0-b66d-55bbf7f77880": {
    uk: "Теплий деревно-пряний аромат, у якому соковите яблуко поєднується з корицею. Кедр і мускус надають композиції стриманої елегантності та стійкості. Надійний вибір для офісу та прохолодних днів.",
    en: "A warm woody spicy scent where juicy apple pairs with cinnamon. Cedar and musk give it understated elegance and staying power. A dependable choice for the office and cooler days.",
  },
  // Bvlgari Elix (Bvlgari)
  "3ced83e8-724a-830e-9bad-6aafc909056e": {
    uk: "Зелено-деревний аромат із соковитим мандарином і грейпфрутом. Кардамон та імбир додають теплої пряності, а амбра робить шлейф м’яким. Підходить і жінкам, і чоловікам, особливо в теплу пору.",
    en: "A green woody scent with juicy mandarin and grapefruit. Cardamom and ginger add a warm spice, while amber softens the trail. Fits anyone, especially in warmer weather.",
  },
  // Carolina Herrera 212 (Carolina Herrera)
  "4ece67d1-32d0-8e72-be6b-bd64ae49eae0": {
    uk: "Свіжий і пікантний аромат, у якому бергамот поєднується з перцем. Мускус робить шлейф чистим, м’яким і сучасним. Зручний на кожен день, для роботи й міських прогулянок.",
    en: "A fresh, peppery scent in which bergamot meets crisp pepper. Musk keeps the trail clean, soft and modern. Easy to wear every day, at work and on long city walks.",
  },
  // Christian Dior Sauvage (Dior)
  "6fee3f20-a688-89c7-a585-a3ca24b91680": {
    uk: "Свіжий пряний фужер із бадьорим бергамотом і соковитим яблуком. Аніс додає пряності, а дубовий мох і пачулі роблять шлейф терпким і глибоким. Універсальний вибір для дня й вечора.",
    en: "A fresh spicy fougère with zesty bergamot and juicy apple. Anise adds spice, while oakmoss and patchouli make the trail dry and deep. A versatile choice for day and night.",
  },
  // Creed Aventus (Creed)
  "7e792725-99f1-8e30-b628-8a0ed36c8f34": {
    uk: "Яскравий цитрусово-деревний аромат із бергамотом, лимоном, чорною смородиною та яблуком. Троянда й жасмин додають елегантної квіткової глибини. Для ділових зустрічей, урочистих подій і впевненого настрою.",
    en: "A bright citrus woody scent with bergamot, lemon, blackcurrant and apple. Rose and jasmine add an elegant floral depth. For business meetings, formal events and a confident mood.",
  },
  // Paco Rabanne Invictus (Paco Rabanne)
  "890868e1-41cd-87d4-86ec-a8df338fb584": {
    uk: "Спортивний свіжий аромат, де юдзу та морські ноти дають відчуття бризу. Кедр і амбра з солодкуватими деревними нотами роблять шлейф теплим і стійким. Для активного дня, спорту та літа.",
    en: "A sporty fresh scent where yuzu and sea notes bring a breezy feel. Cedar and amber with sweet woody notes make the trail warm and lasting. For active days, sport and summer.",
  },
  // Clinique Happy For Men (Clinique)
  "26d9421b-c5d3-8672-9699-2f146b51f51c": {
    uk: "Бадьорий деревний аромат, у якому соковита чорна смородина поєднується з листям кедра. Кедр і пачулі додають деревної глибини та стійкості. Гарний вибір на щодень і для теплої погоди.",
    en: "An upbeat woody scent in which juicy blackcurrant meets cedar leaves. Cedarwood and patchouli add woody depth and staying power. A good everyday pick, especially in warm weather.",
  },
  // Calvin Klein Euphoria (Calvin Klein)
  "3c44268b-1b82-8ef1-84da-a78992ad9373": {
    uk: "Пряний деревний аромат, що відкривається імбиром і перцем. Базилік та шавлія додають трав’янистої свіжості, а білий кедр робить шлейф чистим і сухим. Пасує до вечорів і ділових зустрічей.",
    en: "A spicy woody scent that opens with ginger and pepper. Basil and sage add herbal freshness, while white cedar keeps the trail clean and dry. Suits evenings and business meetings.",
  },
  // VIP Men 212 C.K. (Carolina Herrera)
  "a39e2df5-e9e7-84c6-b509-4864cb46e815": {
    uk: "Вечірній деревно-східний аромат, де свіжі лайм і м’ята контрастують із теплим імбиром. Прянощі додають характеру та глибини шлейфу. Ідеальний для вечірок і нічного міста.",
    en: "An evening woody oriental where fresh lime and mint contrast with warm ginger. Spices add character and depth to the trail. Ideal for parties and nights in the city.",
  },
  // Allure Sport (Chanel)
  "b160b334-df79-8926-a3dc-bdd7e822453f": {
    uk: "Енергійний свіжий аромат з апельсином, мандарином і морськими нотами. Альдегіди та перець надають іскристості, а кедр робить шлейф чистим і деревним. Чудовий вибір для спорту, активних днів і літа.",
    en: "An energetic fresh scent with orange, mandarin and sea notes. Aldehydes and pepper add sparkle, while cedar keeps the trail clean and woody. A great choice for sport, active days and summer.",
  },
  // Diesel Only The Brave (Diesel)
  "c7d14b31-b0bc-8ee6-ba7a-4190d3850a46": {
    uk: "Сміливий деревний аромат, у якому лимон і мандарин переходять у теплі ноти рому та листя кориці. Кедр і чорне дерево роблять шлейф сухим і впевненим. Для вечорів і прохолодної погоди.",
    en: "A bold woody scent in which lemon and mandarin turn into warm notes of rum and cinnamon leaf. Cedar and ebony keep the trail dry and confident. For evenings and cool weather.",
  },
  // Davidoff Cool Water Man (Davidoff)
  "e0128797-9a84-82ed-9ae1-3095aecb29e3": {
    uk: "Прохолодний водяний фужер із лавандою, м’ятою та розмарином. Коріандр додає легкої пряності, а мох і мускус залишають чистий свіжий шлейф. Ідеальний для спеки, спорту й щоденного носіння.",
    en: "A cool aquatic fougère with lavender, mint and rosemary. Coriander adds a light spice, while moss and musk leave a clean, fresh trail. Ideal for hot days, sport and everyday wear.",
  },
  // D&G Pine Apple (Dolce & Gabbana)
  "05083541-9890-829f-a30f-248b7e689b2c": {
    uk: "Соковитий пряний аромат з ананасом, мандарином і журавлиною на старті. Апельсиновий цвіт додає світла, а тютюн з ваніллю роблять шлейф теплим і солодкуватим. Підходить будь-кому і добре звучить увечері.",
    en: "A juicy spicy scent with pineapple, mandarin and cranberry up top. Orange blossom adds brightness, while tobacco and vanilla make the trail warm and slightly sweet. Works for anyone and sounds great in the evening.",
  },
  // Davidoff Adventure (Davidoff)
  "13496011-5abe-88dc-9d2a-d0de6e0b99e5": {
    uk: "Деревно-пряний аромат із цитрусовим стартом з мандарину, лимону та бергамоту. Перець і кунжут додають теплої пікантності, а ветивер і кедр роблять шлейф сухим і мужнім. Для подорожей і щоденних справ.",
    en: "A woody spicy scent with a citrus start of mandarin, lemon and bergamot. Pepper and sesame add a warm kick, while vetiver and cedar make the trail dry and masculine. For travel and everyday plans.",
  },
  // D&G The One (Dolce & Gabbana)
  "8587bc6e-9218-809f-a3cf-d75b4b5ea1b8": {
    uk: "Теплий деревно-пряний аромат, що починається з грейпфрута, коріандру та базиліку. Кардамон та імбир додають пряності, а тютюн робить шлейф глибоким і чуттєвим. Ідеальний для вечорів і холодної пори.",
    en: "A warm woody spicy scent that begins with grapefruit, coriander and basil. Cardamom and ginger add spice, while tobacco makes the trail deep and sensual. Ideal for evenings and the cold season.",
  },
  // Diesel Fuel For Life (Diesel)
  "d3a64be9-dcf9-87de-ba98-bed9915238fb": {
    uk: "Свіжий фужерний аромат, де бергамот і аніс поєднуються з несподіваною малиною. Гальбанум додає зеленої гостроти, а дубовий мох робить шлейф терпким. Для щоденного носіння і прогулянок містом.",
    en: "A fresh fougère where bergamot and anise meet an unexpected raspberry. Galbanum adds a sharp green edge, while oakmoss gives the trail a dry finish. For everyday wear and walks around town.",
  },
  // Davidoff Champion (Davidoff)
  "23bb4d67-7a58-8723-a834-1441cee9d956": {
    uk: "Бадьорий цитрусовий аромат із бергамотом і лимоном на старті. Шавлія додає трав’янистої свіжості, а кедр і дубовий мох роблять шлейф сухим і чистим. Ідеальний для спорту, активних днів і тепла.",
    en: "An invigorating citrus scent with bergamot and lemon up top. Sage adds herbal freshness, while cedar and oakmoss keep the trail dry and clean. Ideal for sport, active days and warm weather.",
  },
  // Egoiste Platinum (Chanel)
  "d4aea1c3-6902-8abe-8eaa-18d5c5b277cf": {
    uk: "Стриманий фужерний аромат із розмарином, лавандою та шавлією. Герань додає квіткової свіжості, а кедр робить шлейф чистим і елегантним. Чудово пасує до костюма, офісу та ділових зустрічей.",
    en: "A refined fougère with rosemary, lavender and sage. Geranium adds a floral freshness, while cedar keeps the trail clean and elegant. Pairs well with a suit, the office and business meetings.",
  },
  // Stronger With You (Giorgio Armani)
  "403faf10-bc78-82ed-9690-64c54c7cf416": {
    uk: "Теплий східний фужер, де рожевий перець і фіалка звучать м’яко та пікантно. Шавлія додає трав’янистості, а ваніль із каштаном роблять шлейф солодкуватим і затишним. Для осінніх і зимових вечорів.",
    en: "A warm oriental fougère where pink pepper and violet feel soft and spicy. Sage adds an herbal touch, while vanilla and chestnut make the trail sweet and cosy. For autumn and winter evenings.",
  },
  // Bois Imperial (Essential Parfums)
  "90ed486e-94d1-8296-b203-9f6565a1e47a": {
    uk: "Сучасний деревний аромат, що відкривається базиліком, грейпфрутом і перцем. Ветивер, кедр і пачулі створюють сухий, трохи землистий шлейф. Підходить будь-кому, для роботи й щоденного носіння.",
    en: "A modern woody scent that opens with basil, grapefruit and pepper. Vetiver, cedar and patchouli build a dry, slightly earthy trail. It suits anyone and works well for the office and everyday wear.",
  },
  // Fahrenheit (Dior)
  "b0f342aa-06ba-8554-87e2-397c58d61b29": {
    uk: "Незвичний зелено-пряний аромат, у якому лимон і бергамот поєднуються з жимолостю. Фіалка надає пудрової глибини, а сандал робить шлейф теплим і м’яким. Для прохолодних днів і вечорів.",
    en: "An unusual green spicy scent in which lemon and bergamot meet honeysuckle. Violet adds a powdery depth, while sandalwood makes the trail warm and smooth. For cool days and evenings.",
  },
  // Givenchy II (Givenchy)
  "4d406cf4-1652-82ac-b581-7bd6d4ba3f74": {
    uk: "Свіжий цитрусовий аромат із бергамотом і грейпфрутом на початку. Лаванда додає трав’янистої чистоти, а ветивер робить шлейф сухим і стриманим. Зручний для роботи та теплої погоди.",
    en: "A fresh citrus scent with bergamot and grapefruit at the start. Lavender adds an herbal cleanness, while vetiver keeps the trail dry and understated. Easy for work and warm weather.",
  },
  // Givenchy Blue Label (Givenchy)
  "bbae143e-6aa4-8523-9dd9-98c5dc44422c": {
    uk: "Пряний аромат, де мандарин зігрітий шафраном. Безсмертник і фіалка надають м’яких пудрових відтінків, а каштан і кедр роблять шлейф теплим. Для осені та вечірніх зустрічей.",
    en: "A spicy scent where mandarin is warmed by saffron. Immortelle and violet add soft powdery shades, while chestnut and cedar make the trail warm. For autumn and evening plans.",
  },
  // Ganymede (Marc-Antoine Barrois)
  "cdd5dca0-b3b5-8227-90bc-c79fe2a28015": {
    uk: "Прохолодний деревний аромат, де бергамот і кіпарис звучать свіжо та чисто. Фіалка додає пудровості, а тютюн, мох і пачулі роблять шлейф глибоким. Однаково пасує жінкам і чоловікам, для дня і вечора.",
    en: "A cool woody scent where bergamot and cypress feel fresh and clean. Violet adds a powdery touch, while tobacco, moss and patchouli deepen the trail. Equally good on anyone, by day or by night.",
  },
  // Gucci By Gucci (Gucci)
  "03112917-fb5e-81c0-9e79-4e9eb4f444bf": {
    uk: "Стриманий цитрусовий аромат із бергамотом і лимоном. Ірис додає пудрової елегантності, а мускус і пачулі роблять шлейф м’яким і стійким. Добре пасує до офісу та ділових зустрічей.",
    en: "An understated citrus scent with bergamot and lemon. Iris adds a powdery elegance, while musk and patchouli keep the trail soft and lasting. Pairs well with the office and business meetings.",
  },
  // Gucci Guilty (Gucci)
  "30de4a18-3265-801a-98f9-b26e148c0b4d": {
    uk: "Сучасний цитрусово-пряний аромат із лимоном і лавандою. Квітка апельсина додає світла, а пачулі й кедр роблять шлейф теплим і впевненим. Для вечорів, побачень і прохолодної пори.",
    en: "A modern citrus spicy scent with lemon and lavender. Orange blossom adds brightness, while patchouli and cedar make the trail warm and confident. For evenings, dates and cooler weather.",
  },
  // Hugo Boss Man (Hugo Boss)
  "08de01fb-2be9-8cc3-9888-e354630bf137": {
    uk: "Свіжий деревний аромат, що відкривається грейпфрутом і рожевим перцем. Герань додає зеленуватої квітковості, а тикове дерево та кедр роблять шлейф сухим і чистим. Підходить для роботи та щоденного носіння.",
    en: "A fresh woody scent that opens with grapefruit and pink pepper. Geranium adds a green floral note, while teak and cedar make the trail dry and clean. Suits work and everyday wear.",
  },
  // Terre D'Hermes (Hermès)
  "3d4d45b8-b169-8986-a4a8-3f0984e01a2a": {
    uk: "Землистий деревний аромат, де мандарин і перець звучать сухо та пікантно. Шавлія додає трав’янистості, мед — легкої теплої солодкості, а ветивер робить шлейф глибоким. Для ділових днів і прохолодної погоди.",
    en: "An earthy woody scent where mandarin and pepper feel dry and spicy. Sage adds an herbal side, honey a light warm sweetness, and vetiver deepens the trail. For business days and cool weather.",
  },
  // Jean Paul Gaultier (Jean Paul Gaultier)
  "7074ebdd-10c0-88b2-b4fe-caa1d2838237": {
    uk: "Деревний аромат, у якому свіжий бергамот поєднується з гіркуватим полином. Мускус і сандал роблять шлейф м’яким, чистим і теплим. Зручний для щоденного носіння та спокійних вечорів.",
    en: "A woody scent in which fresh bergamot meets slightly bitter wormwood. Musk and sandalwood make the trail soft, clean and warm. Easy for everyday wear and quiet evenings.",
  },
  // MF Kurkdjian 724 (Maison Francis Kurkdjian)
  "2a92d6b0-2c25-8f82-b8ce-70737c7473a3": {
    uk: "Прозорий цитрусовий аромат із лимоном і свіжими цитрусами, що звучить як чисте повітря. Квіти та водяні квіти додають легкої, майже невагомої ніжності. Однаково пасує всім, особливо вдень і в теплу пору.",
    en: "A sheer citrus scent with lemon and fresh citrus that feels like clean air. Flowers and water flowers add a light, almost weightless softness. It suits anyone, especially by day and in warm weather.",
  },
  // Kenzo L'Eau Par (Kenzo)
  "5532d1c7-db4f-84d8-8572-741bc185fe91": {
    uk: "Свіжий деревний аромат із юдзу та коріандром на початку. Лісовий горіх і дуб надають теплої деревності, а боби тонка й сандал роблять шлейф м’яким і злегка солодким. Для щоденного носіння й теплих вечорів.",
    en: "A fresh woody scent with yuzu and coriander at the start. Hazelnut and oak add a warm woodiness, while tonka bean and sandalwood make the trail soft and slightly sweet. For everyday wear and warm evenings.",
  },
  // Angel's Share (Kilian)
  "48740e2c-e7fd-8c65-a1f4-fd852da97540": {
    uk: "Теплий східно-квітковий аромат із мигдалем, корицею та сливою, що нагадує святковий десерт. Троянда й магнолія додають квіткової м’якості, а дубовий мох — глибини. Пасує будь-кому і найкраще звучить узимку.",
    en: "A warm oriental floral with almond, cinnamon and plum that recalls a festive dessert. Rose and magnolia add floral softness, while oakmoss brings depth. It suits anyone and is at its best in winter.",
  },
  // Lost Cherry (Tom Ford)
  "5d4163f1-a7b0-8be9-a228-e4249aeccaf2": {
    uk: "Цитрусово-пряний аромат із мандарином і бергамотом на старті. Ірис додає пудрової м’якості, а мускус, кедр і сандал роблять шлейф теплим і стійким. Підходить будь-кому, для вечорів і особливих подій.",
    en: "A citrus spicy scent with mandarin and bergamot at the start. Iris adds a powdery softness, while musk, cedar and sandalwood make the trail warm and lasting. Suits anyone, for evenings and special occasions.",
  },
  // Eclat D'Arpege Pour Homme (Lanvin)
  "b4c5d12f-cc07-8c93-a6b1-43d318a16f37": {
    uk: "Легкий цитрусово-пряний аромат із квітковими нотами та жасмином у серці. Кедр і ветивер надають сухої деревності, а мускус робить шлейф чистим. Зручний для роботи та денних справ.",
    en: "A light citrus spicy scent with floral notes and jasmine at its heart. Cedar and vetiver add a dry woodiness, while musk keeps the trail clean. Easy for work and daytime errands.",
  },
  // Lacoste Red (Lacoste)
  "cefc58b4-bc22-84db-aae5-89d1b6aa381d": {
    uk: "Енергійний деревний аромат із цитрусовим стартом з лимону, мандарину та бергамоту. Троянда й перець додають пікантності, а кедр робить шлейф сухим і чистим. Для спорту, прогулянок і активного дня.",
    en: "An energetic woody scent with a citrus start of lemon, mandarin and bergamot. Rose and pepper add a spicy edge, while cedar keeps the trail dry and clean. For sport, walks and active days.",
  },
  // Lacoste Essential (Lacoste)
  "e9f1f3d4-54ab-8d3b-8842-bf20009a13a1": {
    uk: "Зелений фужерний аромат із бадьорим грейпфрутом, м’ятою та лавандою. Кіпарис додає хвойної свіжості й деревної основи. Добре підходить для спекотних днів, спорту й щоденного носіння.",
    en: "A green fougère with zesty grapefruit, mint and lavender. Cypress adds a coniferous freshness and a woody base. Great for hot days, sport and everyday wear.",
  },
  // Invictus Platinum (Paco Rabanne)
  "a3f8431f-2b2b-8556-89f2-0d16a54c6592": {
    uk: "Яскравий деревно-пряний аромат, де грейпфрут, м’ята та апельсин звучать свіжо й енергійно. Кориця, мірра і троянда додають теплої глибини, а пачулі й амбра тримають стійкий шлейф. Для вечорів і активних днів.",
    en: "A bright woody spicy scent where grapefruit, mint and orange feel fresh and energetic. Cinnamon, myrrh and rose add a warm depth, while patchouli and amber hold a lasting trail. For evenings and active days.",
  },
  // Paco Rabanne One Million (Paco Rabanne)
  "01a348b6-ba22-8808-aeb4-51d6e57fac9c": {
    uk: "Солодкувато-пряний аромат, у якому свіжість грейпфрута та м’яти змінюється теплом кориці. Троянда й шкіра додають характеру, а пачулі з амброю роблять шлейф насиченим. Ідеальний для вечірок і холодної пори.",
    en: "A sweetish spicy scent in which the freshness of grapefruit and mint gives way to warm cinnamon. Rose and leather add character, while patchouli and amber make the trail rich. Ideal for parties and the cold season.",
  },
  // Paco Rabanne XS Black (Paco Rabanne)
  "d6e7d789-b3a1-8030-a64b-9601dd07827f": {
    uk: "Темний східно-деревний аромат, де лимон і шавлія звучать свіжо на початку. Кардамон і кориця додають пряності, а толуанський бальзам робить шлейф смолистим і солодкуватим. Для вечорів і нічних виходів.",
    en: "A dark oriental woody scent where lemon and sage feel fresh at first. Cardamom and cinnamon add spice, while tolu balsam makes the trail resinous and slightly sweet. For evenings and nights out.",
  },
  // Sculpture Homme (Nikos)
  "e77f429a-7d31-86b0-8c95-f8385b5cdb42": {
    uk: "Теплий східно-пряний аромат, де апельсин поєднується зі спеціями та лавандою. Нота чаю додає спокою, а кедр робить шлейф сухим і стриманим. Пасує до роботи та прохолодних днів.",
    en: "A warm spicy oriental where orange blends with spices and lavender. A tea note adds calm, while cedar keeps the trail dry and restrained. Fits the office and cool autumn days.",
  },
  // Lordly (Versace)
  "aa289f49-da0f-8d9f-8f9e-ee624ed8b45a": {
    uk: "Свіжий деревно-цитрусовий аромат із лимоном, бергамотом і м’ятою. Ваніль м’яко зігріває композицію, а кедр додає деревної основи. Зручний на кожен день і для теплої погоди.",
    en: "A fresh woody citrus scent with lemon, bergamot and mint. Vanilla gently warms the blend, while cedar adds a woody base. Easy for everyday wear and warm weather.",
  },
  // Spicebomb (Viktor&Rolf)
  "3b27366a-53a4-8f77-ac45-1f456bad16c8": {
    uk: "Вибуховий пряний аромат, де бергамот і рожевий перець відкривають тепло кориці. Смола елемі та тютюн роблять шлейф насиченим, димним і стійким. Для холодної пори та вечорів.",
    en: "An explosive spicy scent where bergamot and pink pepper open onto warm cinnamon. Elemi resin and tobacco make the trail rich, smoky and long-lasting. For the cold season and evenings.",
  },
  // Xeryus Rouge (Givenchy)
  "151ef555-8b04-8cce-a70b-e4fa224ff7ae": {
    uk: "Пікантний фруктовий аромат, де соковиті фрукти поєднуються з гострим червоним чилійським перцем. Кедр надає композиції сухої деревної основи. Сміливий вибір для вечорів і прохолодної погоди.",
    en: "A spicy fruity scent where juicy fruit meets fiery red Chilean pepper. Cedar gives the blend a dry woody base. A daring choice for evenings and cool weather.",
  },
  // Molecule 02 (Escentric Molecules)
  "008b03e5-d106-8d91-ade5-8d3adb1256d1": {
    uk: "Мінімалістичний деревний аромат, що звучить дуже близько до шкіри. Мускус і амбра створюють тепле, ледь помітне сяйво, а ірис і фіалка додають пудровості. Підходить для щоденного носіння в будь-яку пору.",
    en: "A minimalist woody scent that sits very close to the skin. Musk and amber create a warm, subtle glow, while iris and violet add a powdery touch. Suits everyday wear in any season.",
  },
};
