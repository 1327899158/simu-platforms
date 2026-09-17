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
    try{const info=await request('GET','/files/'+encodeURIComponent(id)+'/url',null,{silent:true});
     let url=info.url;
     if(!url){
      try{
       const file=await new Promise((resolve,reject)=>wx.cloud.downloadFile({fileID:info.fileID,success:resolve,fail:reject}));
       if(!file.tempFilePath)throw Error('未取得图片本地路径');
       url=file.tempFilePath;
      }catch(downloadError){
       try{url=await getTempFileUrl(info.fileID);}
       catch(urlError){throw Error('云图片读取失败：'+(downloadError.errMsg||downloadError.message||'下载失败')+'；'+(urlError.message||urlError.errMsg||'临时地址不可用'));}
      }
     }
     if(version===this._version)this.setData({['pictures['+index+']']:{id,url,error:false}});
    }catch(e){
     console.warn('[case-gallery]',id,e.statusCode||'',e.message||e.errMsg||'图片读取失败');
     if(version===this._version)this.setData({['pictures['+index+']']:{id,url:'',error:true,message:e.message||e.errMsg||'图片读取失败'}});
    }
   }));
  },
  preview(e){const current=this.data.pictures.find(p=>p.id===e.currentTarget.dataset.id);if(!current||!current.url){if(current?.message)wx.showToast({title:current.message,icon:'none'});return this.load();}wx.previewImage({current:current.url,urls:this.data.pictures.filter(p=>p.url).map(p=>p.url)});},
  imageError(e){const id=e.currentTarget.dataset.id,index=this.data.pictures.findIndex(p=>p.id===id&&p.url===e.currentTarget.dataset.url);if(index<0)return;const message=e.detail?.errMsg||'图片无法显示，请点击重试';console.warn('[case-gallery/image]',id,message);this.setData({['pictures['+index+']']:{id,url:'',error:true,message}});},
  remove(e){this.triggerEvent('remove',{id:e.currentTarget.dataset.id});}
 }
});
