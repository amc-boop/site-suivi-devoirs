// Point d'entrée Vercel : toute l'API Express dans une seule fonction (voir vercel.json)
import { app, errorHandler } from '../server/app.js';

app.use(errorHandler);
export default app;
