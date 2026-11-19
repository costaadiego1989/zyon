import {isIP} from 'node:net';import {createHash} from 'node:crypto';import sharp from 'sharp';
import type {S3UploadService} from '../../../shared/storage/s3-upload.service.js';
import {MetaAdsError,type CatalogImagePort} from '../domain/types.js';import {requireIdentifier,type MetaAdsEnvironment} from '../domain/offer.js';

/** Copies an owned canonical photograph; no image-model request or generated-image claim. */
export class CatalogImageAdapter implements CatalogImagePort{
 constructor(private readonly env:MetaAdsEnvironment,private readonly storage:Pick<S3UploadService,'isConfigured'|'upload'>,private readonly request:typeof fetch=fetch){}
 private hosts(){const hosts=(this.env.META_ADS_IMAGE_SOURCE_HOSTS??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);try{if(this.env.AWS_S3_ENDPOINT){const endpoint=new URL(this.env.AWS_S3_ENDPOINT);if(endpoint.protocol==='https:')hosts.push(endpoint.hostname);}else if(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(this.env.AWS_S3_BUCKET??''))hosts.push(`${this.env.AWS_S3_BUCKET}.s3.${this.env.AWS_S3_REGION??'us-east-1'}.amazonaws.com`);}catch{}return hosts;}
 configured(){return Boolean(this.hosts().length&&this.storage.isConfigured());}
 async capture(input:Parameters<CatalogImagePort['capture']>[0]){
  requireIdentifier(input.merchantId);requireIdentifier(input.mediaKey);let source:URL;
  try{source=new URL(input.product.imageUrl??'');if(source.protocol!=='https:'||source.username||source.password||source.hash||source.port&&source.port!=='443'||isIP(source.hostname.replace(/[\[\]]/g,''))||source.hostname==='localhost'||source.hostname.endsWith('.internal')||source.hostname.endsWith('.local')||!this.hosts().includes(source.hostname))throw Error();}catch{throw new MetaAdsError('image_source_untrusted',409);}
  if(!this.configured())throw new MetaAdsError('catalog_photo_storage_unavailable',503);
  const response=await this.request(source.href,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.body||Number(response.headers.get('content-length'))>12000000)throw new MetaAdsError('catalog_photo_unavailable',409);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>12000000){await reader.cancel();throw new MetaAdsError('catalog_photo_too_large',409);}chunks.push(next.value);}
  let image:Buffer;
  try{const bytes=Buffer.concat(chunks),metadata=await sharp(bytes,{limitInputPixels:16777216,animated:false}).metadata();if(!['jpeg','png','webp','avif'].includes(metadata.format??'')||(metadata.pages??1)>1)throw Error();image=await sharp(bytes,{limitInputPixels:16777216,animated:false}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw new MetaAdsError('catalog_photo_invalid',409);}
  const imageSha256=createHash('sha256').update(image).digest('hex'),stored=await this.storage.upload(image,'image/png',`meta-ads/${input.merchantId}/catalog`,`${input.mediaKey}-${imageSha256}`);
  return{url:stored.url,sourceUrl:input.product.imageUrl!,imageSha256};
 }
}
