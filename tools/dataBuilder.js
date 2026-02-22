const fs = require('fs');
const path = require('path');
const axios = require('axios');

const placesPath = path.join(__dirname, '../data', 'places.json');

async function getWikiImage(name) {
  try {
    // بحث موسع مع redirects لضمان الوصول للمقال الصح
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name + ' Egypt')}&gsrlimit=1&prop=pageimages&pithumbsize=1000&format=json&origin=*`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Fasa7nyApp/1.0' },
    });
    const pages = res.data.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
  } catch (e) {
    return null;
  }
}

async function forceUpdateImages() {
  let places = JSON.parse(fs.readFileSync(placesPath, 'utf-8'));
  console.log(`🔥 Force Update Started for ${places.length} places...`);

  let wikiCount = 0;
  let diversifiedCount = 0;

  for (let i = 0; i < places.length; i++) {
    let p = places[i];

    // الشرط هنا أصبح: لو الصورة مكررة أو قديمة أو فاضية، حدثها فوراً
    const isGeneric =
      !p.image ||
      p.image.includes('unsplash.com') ||
      p.image === '' ||
      p.image === '[URL]';

    if (isGeneric) {
      // 1. جرب تجيب صورة حقيقية من ويكيبيديا (للمعالم)
      if (!['Hotels', 'Vacation Rental', 'Restaurants'].includes(p.category)) {
        const img = await getWikiImage(p['Landmark Name (English)']);
        if (img) {
          p.image = img;
          wikiCount++;
          console.log(`✅ [REAL] ${p['Landmark Name (English)']}`);
        } else {
          // لو فشل، حط صورة عشوائية مرتبطة بالمدينة
          p.image = `https://source.unsplash.com/featured/?egypt,${p.Location.split('/')[0]},landmark&sig=${Math.random()}`;
          diversifiedCount++;
        }
      }
      // 2. الفنادق والمطاعم (تنوع بصري كامل)
      else {
        const tag = p.category === 'Hotels' ? 'hotel,room' : 'restaurant,food';
        // الـ sig=${Math.random()} هو السر عشان كل صورة تطلع مختلفة
        p.image = `https://source.unsplash.com/featured/?${tag},luxury&sig=${Math.random()}`;
        diversifiedCount++;
      }
    }

    if (i % 20 === 0) {
      fs.writeFileSync(placesPath, JSON.stringify(places, null, 2));
      console.log(
        `⏳ Progress: ${i}/${places.length} | Real: ${wikiCount} | Diversified: ${diversifiedCount}`,
      );
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  fs.writeFileSync(placesPath, JSON.stringify(places, null, 2));
  console.log(
    `\n🎉 FINISHED! Wiki Images: ${wikiCount}, Diversified: ${diversifiedCount}`,
  );
}

forceUpdateImages();
