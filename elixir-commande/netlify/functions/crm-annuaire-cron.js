import { lancerAnnuaire } from './crm-annuaire-background.js';
// Deux horaires UTC pour couvrir l'heure d'été et l'heure d'hiver de Paris.
export function creerHandlerCronAnnuaire(deps={}) {
  return async()=>{
    const date=(deps.maintenant || (()=>new Date()))(),p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
    if(p.day!=='01' || p.hour!=='05')return {statusCode:200,body:''};
    try{await lancerAnnuaire(deps);return {statusCode:200,body:''};}catch{return {statusCode:503,body:''};}
  };
}
export const handler=creerHandlerCronAnnuaire();
