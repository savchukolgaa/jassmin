// The shop's own bottle photo (#118): every Jassmin perfume is sold in the same clear JASSMIN
// bottle, so one real photo stands in for every product without its own. It's `IMG_1589`
// cropped to 4:5, in five WebP widths with the metadata stripped. Vite fingerprints the files, so
// they're cached for a long time. Isomorphic: only asset URLs.

import shopBottle320 from "~/assets/shop-bottle/shop-bottle-320.webp";
import shopBottle480 from "~/assets/shop-bottle/shop-bottle-480.webp";
import shopBottle640 from "~/assets/shop-bottle/shop-bottle-640.webp";
import shopBottle960 from "~/assets/shop-bottle/shop-bottle-960.webp";
import shopBottle1280Jpeg from "~/assets/shop-bottle/shop-bottle-1280.jpg";
import shopBottle1280 from "~/assets/shop-bottle/shop-bottle-1280.webp";
import { buildSrcSet, type ResponsiveImage } from "./images";

export const SHOP_BOTTLE_IMAGE: ResponsiveImage = {
  url: shopBottle640,
  srcSet: buildSrcSet([
    { url: shopBottle320, width: 320 },
    { url: shopBottle480, width: 480 },
    { url: shopBottle640, width: 640 },
    { url: shopBottle960, width: 960 },
    { url: shopBottle1280, width: 1280 },
  ]),
  // The largest file's size; on `<img>` it only sets the 4:5 aspect ratio.
  width: 1280,
  height: 1600,
};

/**
 * The 1280px photo as a JPEG, for the product feeds (#140): Google accepts WebP, but Meta's
 * catalog only documents JPEG and PNG. 1280×1600, like the WebP.
 */
export const SHOP_BOTTLE_FEED_IMAGE_URL: string = shopBottle1280Jpeg;
