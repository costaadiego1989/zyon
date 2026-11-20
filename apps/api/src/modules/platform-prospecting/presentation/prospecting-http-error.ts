import { BadRequestException,ConflictException,NotFoundException,ServiceUnavailableException,HttpException } from "@nestjs/common";
export function prospectingHttpError(error:unknown):never {
  if(error instanceof HttpException)throw error;
  const code=error instanceof Error?error.message:"prospecting_unavailable";
  if(/^(invalid_|manifest_invalid|manifest_incomplete|source_not_allowed|parser_version_unsupported)/.test(code))throw new BadRequestException(code);
  if(/^(import_not_found|company_not_found|manifest_not_found)/.test(code))throw new NotFoundException(code);
  if(/conflict|import_busy|ingestion_disabled|snapshot_not_writable|import_not_resumable/.test(code))throw new ConflictException(code);
  throw new ServiceUnavailableException(/^(source_unavailable|directory_unavailable|snapshot_unavailable|config_invalid)/.test(code)?code:"prospecting_unavailable");
}
export function requestText(value:unknown,name:string,maximum=200):string|undefined {
  if(value===undefined)return undefined;if(typeof value!=="string"||!value||value.length>maximum)throw new BadRequestException(`invalid_filter:${name}`);return value;
}
export function requestLimit(value:unknown):number|undefined {if(value===undefined)return undefined;if(typeof value!=="string"||!/^\d{1,3}$/.test(value))throw new BadRequestException("invalid_filter:limit");return Number(value);}
export function requestKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new BadRequestException("invalid_filter:unknown_parameter");}
