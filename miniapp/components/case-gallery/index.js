const {request}=require('../../utils/request');
const {getTempFileUrl}=require('../../utils/cloud-file');
Component({
 properties:{ids:{type:Array,value:[],observer(){this.load();}},editable:{type:Boolean,value:false}},
 data:{pictures:[]},
 lifetimes:{detached(){this._version=(this._version||0)+1;}},
 methods:{
  async load(){
   const version=this._version=(this._version||0)+1;
   const ids=this.properties.ids||[];
   this.setData({pictures:ids.map(id=>({id,url:'',error:false}))});
   await Promise.all(ids.map(async(id,index)=>{
    try{const info=await request('GET','/files/'+encodeURIComponent(id)+'/url?preview=1',null,{silent:true});
     const url=info.url||await getTempFileUrl(info.fileID);
     if(version===this._version)this.setData({['pictures['+index+']']:{id,url,error:false}});
    }catch(e){if(version===this._version)this.setData({['pictures['+index+'].error']:true});}
   }));
  },
  preview(e){const current=this.data.pictures.find(p=>p.id===e.currentTarget.dataset.id);if(!current||!current.url)return this.load();wx.previewImage({current:current.url,urls:this.data.pictures.filter(p=>p.url).map(p=>p.url)});},
  remove(e){this.triggerEvent('remove',{id:e.currentTarget.dataset.id});}
 }
});
