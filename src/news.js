// What's new in the app: short posts about new features, newest first. The home page shows a card for
// 7 days after the newest post (then nothing, so the site isn't filled with banners); the page itself
// (#/news) stays, from a quiet link at the bottom of the home page.
//   date   the day it went live (YYYY-MM-DD)
//   only   which sites it's for: family keys (families.mjs), or 'chart' = sites with earlier roots; none = every site
//   href   where "open" goes, when there's a place to go
// In the text: **bold**, _italic_, and [a link](#/tree) to a tab or page of the app.
export const NEWS = [
  { date: '2026-11-18', only: 'chart', href: '#/chart',
    he: ['עץ המשפחה, מצויר', 'עץ משפחה חזותי: ההורים, הסבים והדורות שלפניהם דור מעל דור, והצאצאים מתחת. הוא נפתח מלשונית [עץ](#/chart) בתפריט התחתון (רשימת המשפחות עברה ללשונית [קרובים](#/tree)), או מהשורה שאחרי **סבא וסבתא** בכל **פרופיל**. לחצו על כל אחד כדי לראות את העץ שלו, וחזרו לעץ שלכם בסמל _המטרה_. ב_גלגל השיניים_: כמה דורות להציג, אחים ואחיות, שני הצדדים יחד, ושמירה כתמונה או כ-PDF.'],
    en: ['The family tree, drawn', 'A visual family tree: parents, grandparents and the generations before them, one above the other, and the descendants below. It opens from the [Tree](#/chart) tab on the bottom menu (the list of families moved to the [Relatives](#/tree) tab), or from the row after the **Zaidy & Bubby** section on any **profile**. Tap anyone to see their tree, and get back to your own with the _target_ icon. Under the _gear_: how many generations to show, brothers and sisters, both sides at once, and saving it as a picture or a PDF.'] },
  { date: '2026-11-15',
    he: ['איך אתם קשורים', 'בכל **פרופיל** מופיע עכשיו **איך האדם קשור אליכם**, בכל הדרכים. לחצו על קשר כדי לראות את הדרך ביניכם.'],
    en: ["How you're related", 'Every **profile** now shows **how that person is related to you**, in every way they are. Tap a relationship to see the path between you.'] },
  { date: '2026-11-15',
    he: ['ימי ההולדת ביומן שלכם', 'בעמוד [בית](#/home), ליד "בקרוב במשפחה", הכפתור **הוסף ליומן** נותן קישור שמוסיף ליומן שלכם (גוגל, אייפון, אאוטלוק) את **ימי ההולדת, ימי הנישואין והיארצייטים** של המשפחה.'],
    en: ['Birthdays in your own calendar', 'On the [Home](#/home) page, next to "Coming up", the **Add to calendar** button gives you a link that puts the family\'s **birthdays, anniversaries and yahrzeits** into your own calendar (Google, iPhone, Outlook).'] },
  { date: '2026-11-15',
    he: ['תהילים בפרופיל שלכם', 'ב[פרופיל](#/me) שלכם: **פרק התהילים** של כל אחד מבני המשפחה לשנה שבה הוא נמצא, עם השם ושם האם. ב**גלגל ההגדרות** בוחרים את מי להוסיף.'],
    en: ['Tehillim on your profile', 'On your own [Profile](#/me): each family member\'s **chapter of Tehillim** for the year they are in, with their name and mother\'s name. The **gear** chooses who is included.'] },
];
