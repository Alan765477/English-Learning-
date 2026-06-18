// Built-in practice material. All dialogues are original (copyright-safe).
// Each sentence: { en, ipa, zh }. IPA is a learning aid (approximate).
// Later these can be supplemented by user-imported text or YouTube captions.
const LESSONS = [
  {
    id: 'daily-greetings',
    title: '日常 · 打招呼与寒暄',
    level: '初级',
    sentences: [
      { en: "Hey, it's been a while! How have you been?", ipa: "/heɪ ɪts bɪn ə waɪl haʊ hæv juː bɪn/", zh: "嘿，好久不见！你最近怎么样？" },
      { en: "Pretty good, thanks. I've been really busy with work.", ipa: "/ˈprɪti ɡʊd θæŋks aɪv bɪn ˈrɪli ˈbɪzi wɪð wɜːrk/", zh: "挺好的，谢谢。我最近工作很忙。" },
      { en: "I totally get that. We should grab a coffee sometime.", ipa: "/aɪ ˈtoʊtəli ɡet ðæt wi ʃʊd ɡræb ə ˈkɔːfi ˈsʌmtaɪm/", zh: "我完全理解。我们改天该一起喝杯咖啡。" },
      { en: "Sounds great. How about this weekend?", ipa: "/saʊndz ɡreɪt haʊ əˈbaʊt ðɪs ˈwiːkend/", zh: "听起来不错。这周末怎么样？" },
      { en: "Works for me. I'll text you the details later.", ipa: "/wɜːrks fɔːr miː aɪl tekst juː ðə dɪˈteɪlz ˈleɪtər/", zh: "我可以。我晚点把细节发给你。" },
    ],
  },
  {
    id: 'restaurant',
    title: '生活 · 餐厅点餐',
    level: '初级',
    sentences: [
      { en: "Hi, could we see the menu, please?", ipa: "/haɪ kʊd wi siː ðə ˈmenjuː pliːz/", zh: "你好，可以给我们看一下菜单吗？" },
      { en: "Of course. Can I start you off with something to drink?", ipa: "/əv kɔːrs kæn aɪ stɑːrt juː ɔːf wɪð ˈsʌmθɪŋ tə drɪŋk/", zh: "当然。要先来点喝的吗？" },
      { en: "I'll have a sparkling water, and what do you recommend?", ipa: "/aɪl hæv ə ˈspɑːrklɪŋ ˈwɔːtər ænd wʌt duː juː ˌrekəˈmend/", zh: "我要一杯气泡水，你有什么推荐的吗？" },
      { en: "The grilled salmon is really popular today.", ipa: "/ðə ɡrɪld ˈsæmən ɪz ˈrɪli ˈpɑːpjələr təˈdeɪ/", zh: "今天的烤三文鱼很受欢迎。" },
      { en: "That sounds perfect. I'll go with that.", ipa: "/ðæt saʊndz ˈpɜːrfɪkt aɪl ɡoʊ wɪð ðæt/", zh: "听起来很棒，我就要那个。" },
    ],
  },
  {
    id: 'travel',
    title: '出行 · 机场与方向',
    level: '中级',
    sentences: [
      { en: "Excuse me, could you tell me where the boarding gate is?", ipa: "/ɪkˈskjuːz miː kʊd juː tel miː wer ðə ˈbɔːrdɪŋ ɡeɪt ɪz/", zh: "打扰一下，能告诉我登机口在哪里吗？" },
      { en: "Sure, gate twenty-two is just down the hall on your right.", ipa: "/ʃʊr ɡeɪt ˈtwenti tuː ɪz dʒʌst daʊn ðə hɔːl ɒn jʊr raɪt/", zh: "当然，22 号登机口就在走廊尽头右手边。" },
      { en: "Do you know if the flight is still on time?", ipa: "/duː juː noʊ ɪf ðə flaɪt ɪz stɪl ɒn taɪm/", zh: "你知道航班是否还准时吗？" },
      { en: "It's been delayed by about half an hour, unfortunately.", ipa: "/ɪts bɪn dɪˈleɪd baɪ əˈbaʊt hæf ən ˈaʊər ʌnˈfɔːrtʃənətli/", zh: "很遗憾，航班延误了大约半小时。" },
      { en: "No worries. Thanks for letting me know.", ipa: "/noʊ ˈwɜːriz θæŋks fɔːr ˈletɪŋ miː noʊ/", zh: "没关系，谢谢你告诉我。" },
    ],
  },
  {
    id: 'work',
    title: '职场 · 会议与协作',
    level: '中级',
    sentences: [
      { en: "Let's circle back to this after we've gathered more data.", ipa: "/lets ˈsɜːrkəl bæk tə ðɪs ˈæftər wiːv ˈɡæðərd mɔːr ˈdeɪtə/", zh: "等我们收集到更多数据后，再回头讨论这件事。" },
      { en: "I think we're on the same page about the priorities.", ipa: "/aɪ θɪŋk wɪr ɒn ðə seɪm peɪdʒ əˈbaʊt ðə praɪˈɔːrətiz/", zh: "我觉得我们在优先级上看法一致。" },
      { en: "Could you walk me through your reasoning here?", ipa: "/kʊd juː wɔːk miː θruː jʊr ˈriːzənɪŋ hɪr/", zh: "你能给我讲讲你这里的思路吗？" },
      { en: "Let me follow up with the team and get back to you.", ipa: "/let miː ˈfɒloʊ ʌp wɪð ðə tiːm ænd ɡet bæk tə juː/", zh: "我跟团队再确认一下，然后回复你。" },
      { en: "That makes sense. Let's move forward with it.", ipa: "/ðæt meɪks sens lets muːv ˈfɔːrwərd wɪð ɪt/", zh: "有道理，那我们就这样推进吧。" },
    ],
  },
];
