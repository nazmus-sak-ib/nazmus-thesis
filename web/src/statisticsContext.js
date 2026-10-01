import {createContext} from 'react';
import {DEFAULT_STATISTICS} from './statisticsStyle.js';
export const StatisticsContext=createContext({settings:DEFAULT_STATISTICS,update:()=>{}});
export const ResultDataContext=createContext(null);
