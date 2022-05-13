import * as language from '@google-cloud/language';
import * as credentials from '../../static/dialogger.json';

export const client = () => {
    return new language.LanguageServiceClient({credentials});
}