import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitPhoneDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}

export class SubmitCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class SubmitPasswordDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class ChannelDto {
  @IsString()
  @IsNotEmpty()
  /** Channel username (e.g. "obsidian_uz") or peer ID */
  channel!: string;
}
