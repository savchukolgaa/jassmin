import type { Schema, Struct } from '@strapi/strapi';

export interface CatalogFragranceFamily extends Struct.ComponentSchema {
  collectionName: 'components_catalog_fragrance_families';
  info: {
    description: 'One fragrance family of a perfume. The first one is the main family, shown on the product card; drag to reorder';
    displayName: 'Fragrance family';
    icon: 'seed';
  };
  attributes: {
    family: Schema.Attribute.Enumeration<
      [
        '\u043A\u0432\u0456\u0442\u043A\u043E\u0432\u0456',
        '\u0444\u0440\u0443\u043A\u0442\u043E\u0432\u0456',
        '\u0441\u0445\u0456\u0434\u043D\u0456',
        '\u0432\u043E\u0434\u044F\u043D\u0456',
        '\u0448\u0438\u043F\u0440\u043E\u0432\u0456',
        '\u0434\u0435\u0440\u0435\u0432\u043D\u0456',
        '\u043C\u0443\u0441\u043A\u0443\u0441\u043D\u0456',
        '\u043F\u0440\u044F\u043D\u0456',
        '\u0433\u0443\u0440\u043C\u0430\u043D\u0441\u044C\u043A\u0456',
        '\u0437\u0435\u043B\u0435\u043D\u0456',
        '\u0432\u0430\u043D\u0456\u043B\u044C\u043D\u0456',
        '\u0430\u0440\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u0456',
        '\u0430\u043B\u044C\u0434\u0435\u0433\u0456\u0434\u043D\u0456',
        '\u0446\u0438\u0442\u0440\u0443\u0441\u043E\u0432\u0456',
        '\u0441\u0432\u0456\u0436\u0456',
        '\u0444\u0443\u0436\u0435\u0440\u043D\u0456',
      ]
    > &
      Schema.Attribute.Required;
  };
}

export interface CatalogNote extends Struct.ComponentSchema {
  collectionName: 'components_catalog_notes';
  info: {
    description: 'One scent note of a perfume, in Ukrainian, e.g. \u00AB\u043B\u0438\u043C\u043E\u043D\u00BB';
    displayName: 'Scent note';
    icon: 'feather';
  };
  attributes: {
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
  };
}

export interface CatalogVariant extends Struct.ComponentSchema {
  collectionName: 'components_catalog_variants';
  info: {
    description: 'One size of a perfume: volume (5, 10, 30, 50 or 100 ml) and price in UAH. Always available unless Track stock is on; then units in stock limit sales';
    displayName: 'Size';
    icon: 'shoppingCart';
  };
  attributes: {
    price: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0.01;
        },
        number
      >;
    stock: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    trackStock: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    volumeMl: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
  };
}

export interface HomeAbout extends Struct.ComponentSchema {
  collectionName: 'components_home_abouts';
  info: {
    description: 'Brand story';
    displayName: 'About';
    icon: 'information';
  };
  attributes: {
    body: Schema.Attribute.RichText & Schema.Attribute.Required;
    imageAlt: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    imageLocalized: Schema.Attribute.Media<'images'>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
  };
}

export interface HomeHero extends Struct.ComponentSchema {
  collectionName: 'components_home_heroes';
  info: {
    description: 'Home page hero with the current offer';
    displayName: 'Hero';
    icon: 'star';
  };
  attributes: {
    ctaHref: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    ctaLabel: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    eyebrow: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    headline: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    imageAlt: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    imageLocalized: Schema.Attribute.Media<'images'>;
    secondaryCtaHref: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    secondaryCtaLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    subtitle: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface HomeLocation extends Struct.ComponentSchema {
  collectionName: 'components_home_locations';
  info: {
    description: 'Store address and opening hours. Opening hours: one range per line, e.g. "\u041F\u043D\u2013\u041F\u0442 10:00\u201320:00" or "Mon\u2013Fri 10:00\u201320:00". Street, city, postcode and coordinates are optional and only used for Google search results.';
    displayName: 'Location';
    icon: 'pinMap';
  };
  attributes: {
    address: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    addressLocality: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    latitude: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 90;
          min: -90;
        },
        number
      >;
    longitude: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 180;
          min: -180;
        },
        number
      >;
    mapEmbedUrl: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    openingHours: Schema.Attribute.Text;
    postalCode: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 10;
      }>;
    streetAddress: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
  };
}

export interface OffersProductRef extends Struct.ComponentSchema {
  collectionName: 'components_offers_product_refs';
  info: {
    description: 'A product from the Jassmin shop, by its public id (UUID)';
    displayName: 'Product reference';
    icon: 'shoppingCart';
  };
  attributes: {
    publicId: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface OrdersItem extends Struct.ComponentSchema {
  collectionName: 'components_orders_items';
  info: {
    description: 'A bought size, as it was at checkout';
    displayName: 'Order line';
    icon: 'shoppingCart';
  };
  attributes: {
    brand: Schema.Attribute.String;
    productName: Schema.Attribute.String;
    productPublicId: Schema.Attribute.String;
    quantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    unitPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
    volumeMl: Schema.Attribute.Integer;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: 'Search and social sharing metadata';
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    ogImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSocialLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_links';
  info: {
    description: "A link to one of the store's social profiles";
    displayName: 'Social link';
    icon: 'link';
  };
  attributes: {
    platform: Schema.Attribute.Enumeration<
      ['instagram', 'facebook', 'tiktok', 'telegram', 'viber', 'youtube']
    > &
      Schema.Attribute.Required;
    url: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'catalog.fragrance-family': CatalogFragranceFamily;
      'catalog.note': CatalogNote;
      'catalog.variant': CatalogVariant;
      'home.about': HomeAbout;
      'home.hero': HomeHero;
      'home.location': HomeLocation;
      'offers.product-ref': OffersProductRef;
      'orders.item': OrdersItem;
      'shared.seo': SharedSeo;
      'shared.social-link': SharedSocialLink;
    }
  }
}
