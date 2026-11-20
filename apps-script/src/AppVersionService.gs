function appUiVersion_(){
  return shopeeSignature_(['Index','Styles','Logo','AuthLoading','Scripts','Pages','Ops','SkuPicker','PackageForm','Shopee','ShopeePlacement','ShopeePackage','ShopeeReviewHelpers','ShopeeWorkflow','ShopeeWorkspace','ShopeeSelection','ShopeeBatch','Wizard','Photo','Mobile','AppUpdate'].map(include));
}
