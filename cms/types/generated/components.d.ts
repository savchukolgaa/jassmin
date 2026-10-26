import type { Schema, Struct } from '@strapi/strapi';

export interface CatalogVariant extends Struct.ComponentSchema {
  collectionName: 'components_catalog_variants';
  info: {
    description: 'One size of a perfume: volume (7, 10, 30, 50 or 100 ml), price in UAH and units in stock';
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
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
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
    image: Schema.Attribute.Media<'images'>;
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
    image: Schema.Attribute.Media<'images'>;
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
    description: 'Store address and opening hours';
    displayName: 'Location';
    icon: 'pinMap';
  };
  attributes: {
    address: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    mapEmbedUrl: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    openingHours: Schema.Attribute.Text;
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
