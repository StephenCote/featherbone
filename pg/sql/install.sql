﻿/**
    Featherbone is a JavaScript based persistence framework for building object relational database applications
    
    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/** Expose certain js functions to the database for use as defaults **/
create or replace function fp.get_current_user() returns text as $$
  return (function () {
    if (!plv8._init) { plv8.execute('select fp.init()'); }

    return featherbone.getCurrentUser();
  }());
$$ language plv8;

create or replace function fp.request(obj json) returns json as $$
  return (function () {
    /** if (!plv8._init) { */
    plv8.execute('select fp.init()'); 
    /**} */

    return featherbone.request(obj);
  }());
$$ language plv8;

do $$
   plv8.execute('select fp.init()');
   var sqlChk = "select * from pg_tables where schemaname = 'fp' and tablename = $1;",
     sql,
     format = featherbone.format;

   /** Create the base object table **/
   if (!plv8.execute(sqlChk,['object']).length) {
     sql = "create table fp.object (" +
       "_pk bigserial primary key," +
       "id text not null unique," +
       "created timestamp with time zone not null default now()," +
       "created_by text not null default fp.get_current_user()," +
       "updated timestamp with time zone not null default now()," +
       "updated_by text not null default fp.get_current_user()," +
       "is_deleted boolean not null default false)";
     plv8.execute(sql);
     plv8.execute("comment on table fp.object is 'Abstract object from which all objects will inherit.'");
     sql = "comment on column %I.%I.%I is %L";
     plv8.execute(sql.format(['fp','object','_pk','Internal primary key']));
     plv8.execute(sql.format(['fp','object','id','Surrogate key']));
     plv8.execute(sql.format(['fp','object','created','Create time of the record']));
     plv8.execute(sql.format(['fp','object','created_by','User who created the record']));
     plv8.execute(sql.format(['fp','object','updated','Last time the record was updated']));
     plv8.execute(sql.format(['fp','object','updated_by','Last user who created the record']));
   };

   /** Create the base log table **/
   if (!plv8.execute(sqlChk,['log']).length) {
     sql = "create table fp.log (" +
       "change json," +
       "constraint log_pkey primary key (_pk), " +
       "constraint log_id_key unique (id)) inherits (fp.object)";
     plv8.execute(sql);
     plv8.execute("comment on table fp.object is 'Abstract object from which all objects will inherit.'");
     sql = "comment on column %I.%I.%I is %L";
     plv8.execute(sql.format(['fp','log','change','Patch formatted json indicating changes']));
   };
$$ language plv8;